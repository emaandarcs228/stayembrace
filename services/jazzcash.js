// =====================================================================
// services/jazzcash.js
// JazzCash Mobile Wallet (MWALLET) Integration
//
// ENVIRONMENT VARIABLES REQUIRED (.env):
//   JAZZCASH_MERCHANT_ID=
//   JAZZCASH_PASSWORD=
//   JAZZCASH_INTEGRITY_KEY=
//   JAZZCASH_SANDBOX=true          (set to false for production)
//   APP_URL=http://localhost:3000  (already in your .env — reused here)
//
// HOW IT WORKS:
//   1. Student selects dues to pay, enters JazzCash mobile number
//   2. Server builds payload, generates HMAC-SHA256 secure hash
//   3. Server POSTs to JazzCash API → JazzCash sends MPIN prompt to student's phone
//   4. Student approves on their phone
//   5. JazzCash POSTs result to pp_ReturnURL (/student/payments/jazzcash/callback)
//   6. Server verifies hash on callback, updates Payment + Due records
// =====================================================================

const crypto = require('crypto');
const axios  = require('axios');

// ── Endpoints ──────────────────────────────────────────────────────
const SANDBOX_URL    = 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction';
const PRODUCTION_URL = 'https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction';

function getApiUrl() {
    return process.env.JAZZCASH_SANDBOX === 'false' ? PRODUCTION_URL : SANDBOX_URL;
}

// ── Credentials ────────────────────────────────────────────────────
function getCreds() {
    const merchantId   = process.env.JAZZCASH_MERCHANT_ID;
    const password     = process.env.JAZZCASH_PASSWORD;
    const integrityKey = process.env.JAZZCASH_INTEGRITY_KEY;

    if (!merchantId || !password || !integrityKey) {
        throw new Error(
            'JazzCash credentials missing. Set JAZZCASH_MERCHANT_ID, ' +
            'JAZZCASH_PASSWORD, and JAZZCASH_INTEGRITY_KEY in your .env file.'
        );
    }
    return { merchantId, password, integrityKey };
}

// ── DateTime helpers ────────────────────────────────────────────────
function formatDateTime(date) {
    // JazzCash format: yyyyMMddHHmmss
    const d = date || new Date();
    return d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') +
        String(d.getHours()).padStart(2, '0') +
        String(d.getMinutes()).padStart(2, '0') +
        String(d.getSeconds()).padStart(2, '0');
}

function getExpiryDateTime(minutesFromNow = 60) {
    const d = new Date(Date.now() + minutesFromNow * 60 * 1000);
    return formatDateTime(d);
}

// ── Secure Hash ─────────────────────────────────────────────────────
// JazzCash hash: sort all pp_ keys alphabetically, join values with &,
// prepend integrityKey&, then HMAC-SHA256.
function generateSecureHash(params, integrityKey) {
    const sortedKeys = Object.keys(params)
        .filter(k => k.startsWith('pp_') && params[k] !== '' && params[k] !== undefined)
        .sort();

    const hashString = integrityKey + '&' + sortedKeys.map(k => params[k]).join('&');

    return crypto
        .createHmac('sha256', integrityKey)
        .update(hashString)
        .digest('hex')
        .toUpperCase();
}

// ── Verify callback hash ─────────────────────────────────────────────
function verifyCallbackHash(params) {
    try {
        const { integrityKey } = getCreds();
        const receivedHash = params.pp_SecureHash;
        const paramsWithoutHash = Object.assign({}, params);
        delete paramsWithoutHash.pp_SecureHash;

        const expectedHash = generateSecureHash(paramsWithoutHash, integrityKey);
        return receivedHash === expectedHash;
    } catch (err) {
        console.error('Hash verification error:', err);
        return false;
    }
}

// ── Unique transaction ref ───────────────────────────────────────────
function generateTxnRef() {
    const now  = formatDateTime(new Date());
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'T' + now + rand;
}

// ── Amount to paisas ────────────────────────────────────────────────
// JazzCash treats last 2 digits as decimal places.
// Rs 500.00 → "50000"
function toPaisas(amountRs) {
    return String(Math.round(Number(amountRs) * 100));
}

// ═══════════════════════════════════════════════════════════════════
// MAIN: Initiate Mobile Wallet Transaction
// ═══════════════════════════════════════════════════════════════════
async function initiateTransaction({
    mobileNumber,   // Student's JazzCash number e.g. "03001234567"
    amountRs,       // Amount in rupees e.g. 500
    billReference,  // Your internal reference e.g. payment._id
    description,    // e.g. "Hostel Fee Payment"
    txnRef          // Optional — pass existing or auto-generate
}) {
    let merchantId, password, integrityKey;
    try {
        ({ merchantId, password, integrityKey } = getCreds());
    } catch (credErr) {
        console.error('JazzCash credentials error:', credErr.message);
        return {
            success        : false,
            responseCode   : 'CFG',
            responseMessage: 'JazzCash is not configured yet (missing credentials). Set JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, and JAZZCASH_INTEGRITY_KEY in .env.',
            txnRefNo       : txnRef || generateTxnRef(),
            rawResponse    : null
        };
    }

    const now       = new Date();
    const txnRefNo  = txnRef || generateTxnRef();
    const txnDT     = formatDateTime(now);
    const txnExpiry = getExpiryDateTime(60);
    const returnUrl = (process.env.APP_URL || 'http://localhost:3000') +
                      '/student/payments/jazzcash/callback';

    // Normalize mobile number — JazzCash expects 03XXXXXXXXX format
    const normalizedMobile = normalizeMobile(mobileNumber);
    const safeDescription  = (description || 'Hostel Payment')
        .replace(/[<>\\*=%/:'\|"{}]/g, ' ')
        .substring(0, 100);

    const params = {
        pp_Version          : '1.1',
        pp_TxnType          : 'MWALLET',
        pp_Language         : 'EN',
        pp_MerchantID       : merchantId,
        pp_SubMerchantID    : '',
        pp_Password         : password,
        pp_BankID           : 'TBANK',
        pp_ProductID        : 'RETL',
        pp_TxnRefNo         : txnRefNo,
        pp_Amount           : toPaisas(amountRs),
        pp_TxnCurrency      : 'PKR',
        pp_TxnDateTime      : txnDT,
        pp_BillReference    : String(billReference),
        pp_Description      : safeDescription,
        pp_TxnExpiryDateTime: txnExpiry,
        pp_ReturnURL        : returnUrl,
        pp_SecureHash       : '',
        ppmpf_1             : normalizedMobile,
        ppmpf_2             : '',
        ppmpf_3             : '',
        ppmpf_4             : '',
        ppmpf_5             : ''
    };

    // Generate and attach secure hash
    params.pp_SecureHash = generateSecureHash(params, integrityKey);

    try {
        const response = await axios.post(getApiUrl(), params, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        const data = response.data;

        return {
            success        : data.pp_ResponseCode === '000',
            responseCode   : data.pp_ResponseCode,
            responseMessage: data.pp_ResponseMessage,
            txnRefNo       : data.pp_TxnRefNo || txnRefNo,
            authCode       : data.pp_AuthCode || null,
            rrn            : data.pp_RetreivalReferenceNo || null,
            rawResponse    : data
        };

    } catch (err) {
        console.error('JazzCash API error:', err.message);
        return {
            success        : false,
            responseCode   : 'ERR',
            responseMessage: 'Could not reach JazzCash. Please try again.',
            txnRefNo,
            rawResponse    : null
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Parse and validate callback from JazzCash
// ═══════════════════════════════════════════════════════════════════
function parseCallback(body) {
    const isValid   = verifyCallbackHash(body);
    const isSuccess = body.pp_ResponseCode === '000';

    return {
        isValid,
        isSuccess,
        responseCode    : body.pp_ResponseCode,
        responseMessage : body.pp_ResponseMessage,
        txnRefNo        : body.pp_TxnRefNo,
        billReference   : body.pp_BillReference,
        amount          : body.pp_Amount ? Number(body.pp_Amount) / 100 : 0, // paisas → Rs
        authCode        : body.pp_AuthCode || null,
        rrn             : body.pp_RetreivalReferenceNo || null,
        mobileNumber    : body.ppmpf_1 || null,
        settlementExpiry: body.pp_SettlementExpiry || null,
        rawBody         : body
    };
}

// ═══════════════════════════════════════════════════════════════════
// Normalize mobile number
// Accepts: 03001234567 / +923001234567 / 923001234567
// Returns: 03001234567
// ═══════════════════════════════════════════════════════════════════
function normalizeMobile(number) {
    if (!number) return '';
    let n = String(number).trim().replace(/\s|-/g, '');
    if (n.startsWith('+92')) n = '0' + n.slice(3);
    if (n.startsWith('92') && n.length === 12) n = '0' + n.slice(2);
    return n;
}

// ═══════════════════════════════════════════════════════════════════
// Response code descriptions (for user-friendly error messages)
// ═══════════════════════════════════════════════════════════════════
const RESPONSE_CODES = {
    '000': 'Transaction successful.',
    '001': 'Mobile wallet not found. Please check your JazzCash number.',
    '002': 'Mobile wallet blocked. Contact JazzCash support.',
    '003': 'Invalid MPIN entered.',
    '101': 'Transaction declined.',
    '157': 'Insufficient balance in your JazzCash wallet.',
    '200': 'Transaction already processed.',
    '400': 'Invalid request parameters.',
    '401': 'Authentication failed. Invalid merchant credentials.',
    '999': 'System error. Please try again later.'
};

function getResponseDescription(code) {
    return RESPONSE_CODES[code] || 'Transaction failed. Please try again.';
}

module.exports = {
    initiateTransaction,
    parseCallback,
    verifyCallbackHash,
    generateTxnRef,
    toPaisas,
    normalizeMobile,
    getResponseDescription
};