import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as gcp from "@pulumi/gcp";
import { ProjectDetails } from "./types";

// Comment out the following line if you are using the hard coded project data
import { projectData } from "./members";

if (!process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    throw new pulumi.RunError("GOOGLE_CLOUD_QUOTA_PROJECT environment variable is required");
}

const GCPConfig = new pulumi.Config("gcp");
const masterProjectId = GCPConfig.require("project");
const defaultRegion = GCPConfig.get("region") || "us-central1";

const envConfig = new pulumi.Config("env");
const billingAccountId = envConfig.require("billingAccountId");
const organizationId = envConfig.require("organizationId");
const updateFunctionFlag = envConfig.getBoolean("updateFunctionFlag");
const FUNCTION_ZIP_PATH = "../function.zip";

/**
 * The Sample project Data with budget alert and pubsub setup
 * You can either hard code the project data here in the format of ProjectDetails[]
 * or you can use the projectData from members.ts
 * members.ts is added in .gitignore so that you can add your own project data and not worry about it being pushed to the repository. 
 * But it will be still be available in the pulumi state and backed up in the cloud storage bucket
 */

// const projectData: ProjectDetails[] = [
//     {
//         projectDisplayName: "John Doe's Project",
//         projectId: "acme-john-doe-1",
//         owners: ["john.doe@acme.org"],
//         budgetAmount: "100", // 100$
//     },
//     {
//         projectDisplayName: "Mary Willis's Project",
//         projectId: "acme-mary-willis-1",
//         owners: ["mary.willis@acme.org"],
//         budgetAmount: "200", // 200$
//     },
// ]

// Create a random bucket suffix to avoid conflicts since bucket names are globally unique
const randomBucketSuffix = new random.RandomUuid("random-bucket-suffix", {});

const topic = new gcp.pubsub.Topic("budget-alerts", {
    name: "project-budget-alerts",
    project: masterProjectId,
    messageStoragePolicy: {
        allowedPersistenceRegions: ["us-central1"],
    },
});

const bucketForKillswitchFunction = new gcp.storage.Bucket("killswitch-function-package", {
    name: pulumi.interpolate`sandbox-pulumi-${randomBucketSuffix.result}`,
    project: masterProjectId,
    location: defaultRegion,
});

const killswitchFunctionZip = new gcp.storage.BucketObject("killswitch-function-zip", {
    bucket: bucketForKillswitchFunction.name,
    name: "killswitch-function-package.zip",
    source: new pulumi.asset.FileArchive(FUNCTION_ZIP_PATH),
    contentType: "application/zip",
}, {
    ignoreChanges: updateFunctionFlag ? [] : ["source"],
});

// Back Up Projects Details to Cloud Storage Bucket
const projectDetailsBackupObject = new gcp.storage.BucketObject("project-details-backup", {
    bucket: bucketForKillswitchFunction.name,
    name: "project-details-backup.json",
    source: new pulumi.asset.StringAsset(JSON.stringify(projectData, null, 2)),
    contentType: "application/json",
});

function createProjectWithBudgetAlert(projectDetails: ProjectDetails) {

    const { projectDisplayName, projectId, owners, budgetAmount } = projectDetails;

    // Create Project
    const project = new gcp.organizations.Project(projectDisplayName, {
        name: projectDisplayName,
        projectId: projectId,
        orgId: organizationId,
    });

    // Associate Billing Account with Project
    const billingAccount = new gcp.billing.ProjectInfo(`${projectId}-billing-account`, {
        project: project.projectId,
        billingAccount: billingAccountId,
    }, {
        dependsOn: [project],
    });

    // The Owner Invite would only work if the email is not external to your orgranization
    // See: https://cloud.google.com/iam/docs/understanding-roles#owner

    // Instead I am using the IAM Admin Role to enable the user to invite themselves
    new gcp.projects.IAMBinding(`${projectId}-editor-binding`, {
        project: project.projectId,
        role: "roles/editor",
        members: owners.map(owner => `user:${owner}`),
    }, {
        dependsOn: [project],
    });
    // The user can technically invite themselves as owners of the project if they are IAM Admin 
    new gcp.projects.IAMBinding(`${projectId}-iam-admin-binding`, {
        project: project.projectId,
        role: "roles/resourcemanager.projectIamAdmin",
        members: owners.map(owner => `user:${owner}`),
    }, {
        dependsOn: [project],
    });

    // Enable Budgets API
    const budgetsService = new gcp.projects.Service(`${projectId}-budgets`, {
        project: project.projectId,
        service: "billingbudgets.googleapis.com",
    }, {
        dependsOn: [project],
    });

    // Create Budget Alert
    const budgetAlerts = new gcp.billing.Budget(`${projectId}-budget-alerts`, {
        displayName: `${projectDisplayName} Budget Alert`,
        amount: {
            specifiedAmount: {
                units: budgetAmount,
                currencyCode: "USD",
            },
        },
        billingAccount: billingAccountId,
        budgetFilter: {
            projects: [pulumi.interpolate`projects/${project.number}`],
            calendarPeriod: "MONTH",
            creditTypesTreatment: "INCLUDE_SPECIFIED_CREDITS",
            creditTypes: ["SUBSCRIPTION_BENEFIT"],
        },
        allUpdatesRule: {
            pubsubTopic: topic.id,
        },
        thresholdRules: [
            { thresholdPercent: 0.5, spendBasis: "CURRENT_SPEND" },
            { thresholdPercent: 0.8, spendBasis: "CURRENT_SPEND" },
            { thresholdPercent: 1.0, spendBasis: "CURRENT_SPEND" },
        ],
    }, {
        dependsOn: [project, billingAccount, budgetsService],
    });

    return {
        projectId: project.projectId,
        budgetAlertId: budgetAlerts.id.apply(id => id.split("/").pop()!),
    };
}

const result = projectData.map(createProjectWithBudgetAlert);

const budgetIdToProjectIdmapping = pulumi.all(result).apply(result => {
    return Object.fromEntries(
        result.map(({ projectId, budgetAlertId }) => [budgetAlertId, projectId])
    );
});

// Create Service Account For Cloud Function
const killswitchFunctionServiceAccount = new gcp.serviceaccount.Account("killswitch-function-service-account", {
    accountId: "billing-killswitch-function",
    project: masterProjectId,
    displayName: "Function Service Account For Billing KillSwitch",
});

new gcp.projects.IAMMember("killswitch-function-service-account-iam-user", {
    project: masterProjectId,
    role: "roles/iam.serviceAccountUser",
    member: killswitchFunctionServiceAccount.member,
});

new gcp.projects.IAMMember("killswitch-function-service-account-iam-token", {
    project: masterProjectId,
    role: "roles/iam.serviceAccountTokenCreator",
    member: killswitchFunctionServiceAccount.member,
});

new gcp.projects.IAMMember("killswitch-function-service-account-iam-compute-viewer", {
    project: masterProjectId,
    role: "roles/compute.viewer",
    member: killswitchFunctionServiceAccount.member,
});

/**
 * The Cloud Function that will be triggered by the PubSub Topic
 * It will stop billing for the project associated with the budget alert
 * It will also send an email to the project owners
 */
const killswitchFunction = new gcp.cloudfunctions.Function("killswitch-function", {
    name: "billing-killswitch-function",
    runtime: "nodejs18",
    region: defaultRegion,
    serviceAccountEmail: killswitchFunctionServiceAccount.email,
    sourceArchiveBucket: bucketForKillswitchFunction.name,
    sourceArchiveObject: killswitchFunctionZip.name,
    entryPoint: "stopBilling",
    eventTrigger: {
        eventType: "google.pubsub.topic.publish",
        resource: topic.id,
        failurePolicy: {
            retry: true,
        },
    },
    minInstances: 0,
    maxInstances: 1,
    ingressSettings: "ALLOW_INTERNAL_ONLY",
    availableMemoryMb: 512,
    timeout: 60,
    environmentVariables: {
        BUDGET_ID_TO_PROJECT_ID_MAPPING: budgetIdToProjectIdmapping.apply(mapping => JSON.stringify(mapping)),
    },
});

// Grant the Cloud Function Service Account the Billing Admin Role at the Billing Account Level
new gcp.billing.AccountIamMember("killswitch-function-billing-admin-iam", {
    billingAccountId: billingAccountId,
    role: "roles/billing.admin",
    member: killswitchFunctionServiceAccount.member,
});

export const topicName = topic.name;
export const functionServiceAccountEmail = killswitchFunction.serviceAccountEmail;
export const budgetIdToProjectIdmap = budgetIdToProjectIdmapping;