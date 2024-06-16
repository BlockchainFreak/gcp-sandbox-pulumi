
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const billing = google.cloudbilling('v1').projects;

exports.stopBilling = async pubsubEvent => {

    console.log(pubsubEvent);

    const pubsubData = JSON.parse(
        Buffer.from(pubsubEvent.data, 'base64').toString()
    );

    const { costAmount, budgetAmount } = pubsubData;
    const { budgetId } = pubsubEvent.attributes;

    const projectId = _getProjectIdFromBudgetId(budgetId);

    if (costAmount <= budgetAmount) {
        console.log("No action necessary.");
        return `No action necessary. (Current cost: ${pubsubData.costAmount})`;
    }

    if (!projectId) {
        console.log("no project specified");
        return 'No project specified';
    }

    _setAuthCredential();

    const projectName = `projects/${projectId}`;

    const billingEnabled = await _isBillingEnabled(projectName);
    if (billingEnabled) {
        console.log("disabling billing");
        return _disableBillingForProject(projectName);
    } else {
        console.log("billing already disabled");
        return 'Billing already disabled';
    }
};

/**
 * @return {Promise} Credentials set globally
 */
const _setAuthCredential = () => {
    const client = new GoogleAuth({
        scopes: [
            'https://www.googleapis.com/auth/cloud-billing',
            'https://www.googleapis.com/auth/cloud-platform',
        ],
    });

    // Set credential globally for all requests
    google.options({
        auth: client,
    });
};

/**
 * Determine whether billing is enabled for a project
 * @param {string} projectName Name of project to check if billing is enabled
 * @return {bool} Whether project has billing enabled or not
 */
const _isBillingEnabled = async projectName => {
    try {
        const res = await billing.getBillingInfo({
            name: projectName
        });
        console.log(res);
        return res.data.billingEnabled;
    } catch (e) {
        console.log(
            'Unable to determine if billing is enabled on specified project, assuming billing is enabled'
        );
        return true;
    }
};

/**
 * Disable billing for a project by removing its billing account
 * @param {string} projectName Name of project disable billing on
 * @return {string} Text containing response from disabling billing
 */
const _disableBillingForProject = async projectName => {
    const res = await billing.updateBillingInfo({
        name: projectName,
        resource: {
            billingAccountName: ''
        }, // Disable billing
    });
    console.log(res);
    return `Billing disabled: ${JSON.stringify(res.data)}`;
};

/**
 * Get the project id from the budget id using the mapping in the environment variable
 * @param {string} budgetId 
 * @returns {string | null} The project id or null if not found
 */
const _getProjectIdFromBudgetId = budgetId => {
    return JSON.parse(process.env["BUDGET_ID_TO_PROJECT_ID_MAPPING"] ?? "{}")[budgetId]
}