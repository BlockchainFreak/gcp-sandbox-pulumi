# GCP Advanced Sandbox Solution Using Pulumi

This project is designed to help organizations manage multiple sandbox environments on Google Cloud Platform (GCP) for training their employees. It uses Infrastructure as Code (IaC) through Pulumi, which allows the setup and management of cloud resources using code.

#### Key Features and Benefits:

1. **Automated Project Creation**:
   - The project automatically creates sandbox environments (projects) on GCP. These environments are isolated spaces where employees can experiment, learn, and develop without affecting the main production environment.

2. **Budget Alerts**:
   - Each sandbox project has a budget alert set up. This means that if the spending in a sandbox project reaches a certain limit, an alert is triggered. This helps in monitoring and controlling costs.

3. **Cost Cap Mechanism**:
   - To prevent overspending, the project includes a mechanism to automatically stop billing when the budget limit is reached. This is crucial for organizations with strict budget constraints, such as students, researchers, or developers working in test environments.

4. **Cloud Function Trigger**:
   - When a budget alert is triggered, a Cloud Function is automatically executed. This function acts as a `killswitch` and can perform actions like stopping billing or shutting down services to ensure that costs do not exceed the set budget.

5. **Pub/Sub Integration**:
   - The project uses Google Cloud Pub/Sub, a messaging service, to handle budget alerts. When an alert is triggered, a message is published to a Pub/Sub topic, which then triggers the Cloud Function.

#### How It Helps Organizations:

- **Cost Management**: By setting up budget alerts and automatic cost caps, organizations can ensure that their spending on sandbox projects does not exceed predefined limits. This is particularly useful for managing training environments where costs can quickly escalate if not monitored.
  
- **Scalability**: The use of IaC with Pulumi allows organizations to easily scale the number of sandbox projects. New projects can be created with consistent configurations and budget controls, ensuring uniformity and ease of management.

- **Automation**: The entire process, from project creation to budget monitoring and cost control, is automated. This reduces the administrative overhead and allows IT teams to focus on more strategic tasks.

- **Training and Development**: Employees can use these sandbox environments to learn and experiment with GCP services without the risk of affecting production systems or incurring unexpected costs.

### Visual Workflow Explanation:

<figure>
  <img src="https://cloud.google.com/static/billing/docs/images/budget-alert-diagram-pubsub2.png" alt="Budget Alert Pubsub Diagram">
  <figcaption>Illustrates an example of using budget alerts to automate cost control responses using Pub/Sub for programmatic notifications and Cloud Functions to automate a response.</figcaption>
</figure>

The provided diagram illustrates the workflow of the cost control mechanism:

1. **Budget Alert**: When the spending in a sandbox project reaches a predefined limit, a budget alert is triggered.
2. **Cloud Pub/Sub**: The alert is sent as a message to a Pub/Sub topic.
3. **Cloud Functions**: The message triggers a Cloud Function.
4. **Billing API**: The Cloud Function interacts with the Billing API to take necessary actions, such as stopping billing.
5. **Cap Spending**: As a result, the spending is capped, preventing any further costs from being incurred.

## Approach

We would use a master `project` approach where the core infratsructure will be hosted on this project like the pubsub topic and cloud function etc. 

## Get Started

log in using your email account using
```bash
gcloud auth application-default login
```

Make sure that the environment variable `GOOGLE_APPLICATION_CREDENTIALS` is unset. if it is set by default then you can unset it:

```powershell
# powershell
Remove-Item -Path Env:GOOGLE_APPLICATION_CREDENTIALS
```

```bash
# bash
unset GOOGLE_APPLICATION_CREDENTIALS
```

Make sure to enable all necessary api for your master project
```bash
gcloud services enable storage.googleapis.com
gcloud services enable serviceusage.googleapis.com
gcloud services enable pubsub.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudbilling.googleapis.com
```

## Package Your Cloud Function Locally

### Compress the cloud-function directory

```bash
cd killswitch-function \
zip -r ../function.zip .
```

### Set Up Quota Project

The Quota Project Specification is required to create Budget Resource

```bash
# powershell
$env:GOOGLE_CLOUD_QUOTA_PROJECT="any-existing-project-id"
# bash
export GOOGLE_CLOUD_QUOTA_PROJECT="any-existing-project-id"
```

### Running Infrastructure

```bash
npm i -g pnpm
pnpm i
pulumi config set env:billingAccountId {your-billing-acc-id}
pulumi config set env:organizationId {your-org-id}
pulumi config set gcp:project {name-of-your-main-project-for-hosting-pubsub-and-killswitch-function}
pulumi up
```

## Updating Killswitch Function

The first time you run `pulumi up` It will use the function.zip archive to deploy the function but if you want update it you need to explicitly set the `updateFunctionFlag` to `true`.

```bash
pulumi config set env:updateFunctionFlag true
```

## Setting Up Triggers To Cap Costs

See [Why Disable Billing](https://cloud.google.com/billing/docs/how-to/notify#why_disable_billing) to understand the approach for sandbox environments.