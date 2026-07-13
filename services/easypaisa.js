// =====================================================================
// services/easypaisa.js
// Easypaisa Mobile Account (MA) Integration — REST API (no-RSA variant)
//
// IMPORTANT — verify against your actual sandbox docs:
// Easypaisa's public integration guides are inconsistent across versions
// (older SOAP/v1 endpoints vs newer REST/v4 "no-RSA" endpoints, and the
// exact IPN payload fields are configured per-merchant in their portal
// under "IPN Attribute Configurations"). This file targets the v4 REST
// flow, which is the most consistently documented version as of writing.
// Once EasyPaisa's integration team gives you sandbox credentials, check
// the endpoint URL and IPN field names they hand you against what's
// below and adjust if they differ.
//
// ENVIRONMENT VARIABLES REQUIRED (.env):
//   EASYPAISA_STORE_ID=
//   EASYPAISA_USERNAME=
//   EASYPAISA_PASSWORD=
//   EASYPAISA_SANDBOX=true          (set to false for production)
//   APP_URL=http://localhost:3000   (already in your .env — reused here)
//
// HOW IT WORKS:
//   1. Student selects dues to pay, enters Easypaisa mobile account number
//   2. Server POSTs an "initiate-ma-transaction" request (Base64 basic
//      auth via the `Credentials` header, no secure-hash needed for MA)
//   3. Easypaisa sends a confirmation prompt to the student's phone
//   4. Student approves in their Easypaisa app
//   5. Easypaisa posts the result to your configured IPN URL
//      (/student/payments/easypaisa/callback)
//   6. Server updates Payment + Due records
// =====================================================================

const axios = require('axios');

// ── Endpoints ──────────────────────────────────────────────────────
const SANDBOX_BASE    = 'https://easypaystg.easypaisa.com.pk/easypay-service/rest/v4';
const PRODUCTION_BASE = 'https://easypay.easypaisa.com.pk/easypay-service/rest/v4';

function getBaseUrl() {
    return process.env.EASYPAISA_SANDBOX === 'false' ? PRODUCTION_BASE : SANDBOX_BASE;
}

// ── Credentials ────────────────────────────────────────────────────
function getCreds() {
    const storeId  = process.env.EASYPAISA_STORE_ID;
    const username = process.env.EASYPAISA_USERNAME;
    const password = process.env.EASYPAISA_PASSWORD;

    if (!storeId || !username || !password) {
        throw new Error(
            'Easypaisa credentials missing. Set EASYPAISA_STORE_ID, ' +
            'EASYPAISA_USERNAME, and EASYPAISA_PASSWORD in your .env file.'
        );
    }
    return { storeId, username, password };
}

function getAuthHeader(username, password) {
    return Buffer.from(`${username}:${password}`).toString('base64');
}

// ── Unique order id ───────────────────────────────────────────────
function generateOrderId() {
    const now  = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'EP' + now + rand;
}

// ── Normalize mobile number — Easypaisa expects 03XXXXXXXXX ────────
function normalizeMobile(number) {
    if (!number) return '';
    let n = String(number).trim().replace(/\s|-/g, '');
    if (n.startsWith('+92')) n = '0' + n.slice(3);
    if (n.startsWith('92') && n.length === 12) n = '0' + n.slice(2);
    return n;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN: Initiate Mobile Account (MA) Transaction
// ═══════════════════════════════════════════════════════════════════
async function initiateTransaction({
    mobileNumber,   // Student's Easypaisa account number e.g. "03001234567"
    amountRs,       // Amount in rupees e.g. 500
    orderId,        // Optional — pass existing or auto-generate
    emailAddress    // Optional but the API expects the field — falls back below
}) {
    let storeId, username, password;
    try {
        ({ storeId, username, password } = getCreds());
    } catch (credErr) {
        console.error('Easypaisa credentials error:', credErr.message);
        return {
            success        : false,
            responseCode   : 'CFG',
            responseMessage: 'Easypaisa is not configured yet (missing credentials). Set EASYPAISA_STORE_ID, EASYPAISA_USERNAME, and EASYPAISA_PASSWORD in .env.',
            orderId        : orderId || generateOrderId(),
            rawResponse    : null
        };
    }

    const finalOrderId = orderId || generateOrderId();
    const normalizedMobile = normalizeMobile(mobileNumber);

    const body = {
        orderId          : finalOrderId,
        storeId           : Number(storeId),
        transactionAmount : Number(amountRs).toFixed(1),
        transactionType   : 'MA',
        mobileAccountNo   : normalizedMobile,
        emailAddress      : emailAddress || 'noreply@stayembrace.local'
    };

    try {
        const response = await axios.post(
            `${getBaseUrl()}/initiate-ma-transaction`,
            body,
            {
                headers: {
                    'Credentials' : getAuthHeader(username, password),
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const data = response.data;

        return {
            success        : data.responseCode === '0000',
            responseCode   : data.responseCode,
            responseMessage: data.responseDesc,
            orderId        : data.orderId || finalOrderId,
            transactionId  : data.transactionId || null,
            rawResponse    : data
        };

    } catch (err) {
        console.error('Easypaisa API error:', err.message);
        return {
            success        : false,
            responseCode   : 'ERR',
            responseMessage: 'Could not reach Easypaisa. Please try again.',
            orderId        : finalOrderId,
            rawResponse    : null
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Parse the IPN (Instant Payment Notification) Easypaisa posts to your
// configured callback URL once the student confirms/rejects on their
// phone. NOTE: exact field names are configured per-merchant in the
// Easypaisa Merchant Portal under "IPN Attribute Configurations" — this
// covers the commonly documented fields; add any extra optionalN fields
// your portal is configured to send once you can see a real payload.
// ═══════════════════════════════════════════════════════════════════
function parseCallback(body) {
    const isSuccess = body.responseCode === '0000' || body.transactionStatus === 'PAID';

    return {
        isSuccess,
        responseCode      : body.responseCode,
        responseMessage   : body.responseDesc,
        orderId            : body.orderId,
        transactionId       : body.transactionId,
        transactionAmount  : body.transactionAmount ? Number(body.transactionAmount) : 0,
        transactionDateTime: body.transactionDateTime || null,
        mobileNumber       : body.msisdn || body.mobileAccountNo || null,
        rawBody            : body
    };
}

// ═══════════════════════════════════════════════════════════════════
// Response code descriptions
// ═══════════════════════════════════════════════════════════════════
const RESPONSE_CODES = {
    '0000': 'Transaction successful.',
    '0001': 'System error. Please try again later.',
    '0002': 'Required field missing.',
    '0003': 'Invalid order ID.',
    '0004': 'Invalid merchant account number.',
    '0005': 'Merchant account not active. Contact support.',
    '0006': 'Invalid store ID — check your Easypaisa configuration.',
    '0007': 'Store not active. Contact support.',
    '0010': 'Invalid credentials — check your Easypaisa configuration.'
};

function getResponseDescription(code) {
    return RESPONSE_CODES[code] || 'Transaction failed. Please try again.';
}

module.exports = {
    initiateTransaction,
    parseCallback,
    generateOrderId,
    normalizeMobile,
    getResponseDescription
};