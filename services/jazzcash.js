// =====================================================================
// services/jazzcash.js
// JazzCash Mobile Wallet (DoMWalletTransaction) Integration
//
// ENV:
//   JAZZCASH_MERCHANT_ID=
//   JAZZCASH_PASSWORD=
//   JAZZCASH_INTEGRITY_KEY=
//   JAZZCASH_SANDBOX=true
//   APP_URL=http://localhost:3000
//
// Flow:
//   1. Server builds payload + HMAC-SHA256 hash, POSTs to JazzCash API
//   2. JazzCash sends MPIN prompt to student's mobile
//   3. Student approves → JazzCash POSTs result to callback URL
//   4. Server verifies hash on callback, updates Payment + Dues
// =====================================================================

const crypto = require('crypto');
const axios  = require('axios');

// ── Endpoints ──────────────────────────────────────────────────────
const SANDBOX_URL    = 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/DoTransaction';
const PRODUCTION_URL = 'https://payments.jazzcash.com.pk/ApplicationAPI/API/Payment/DoTransaction';

function getApiUrl() {
    return process.env.JAZZCASH_SANDBOX === 'false' ? PRODUCTION_URL : SANDBOX_URL;
}

// ── Credentials ────────────────────────────────────────────────────
function getCreds() {
    const merchantId   = process.env.JAZZCASH_MERCHANT_ID;
    const password     = process.env.JAZZCASH_PASSWORD;
    const integrityKey = process.env.JAZZCASH_INTEGRITY_KEY;

    if (!merchantId || !password || !integrityKey) {
        throw new Error('JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, and JAZZCASH_INTEGRITY_KEY must be set in .env');
    }
    return { merchantId, password, integrityKey };
}

// ── Date/Time ──────────────────────────────────────────────────────
function formatDateTime(date) {
    const d = date || new Date();
    return d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') +
        String(d.getHours()).padStart(2, '0') +
        String(d.getMinutes()).padStart(2, '0') +
        String(d.getSeconds()).padStart(2, '0');
}

function getExpiryDateTime(minutesFromNow = 60) {
    return formatDateTime(new Date(Date.now() + minutesFromNow * 60 * 1000));
}

// ── Secure Hash (HMAC-SHA256) ──────────────────────────────────────
// Matches JazzCash's official CalculateHash algorithm from the sandbox
// test form EXACTLY:
//   1. Include ALL pp_ AND ppmpf_ fields with NON-EMPTY values
//   2. Exclude pp_SecureHash itself
//   3. Sort alphabetically by field name
//   4. Concatenate values with '&', prepend integrityKey + '&'
//   5. HMAC-SHA256 hex (lowercase, as CryptoJS.HmacSHA256 produces)
//
// DEBUG: Set JAZZCASH_DEBUG=true in .env to log the raw hash string
// so you can compare it with the JazzCash Sandbox Hash Calculator.
const JAZZCASH_DEBUG = process.env.JAZZCASH_DEBUG === 'true';

function generateSecureHash(params, integrityKey) {
    const paramsCopy = { ...params };
    delete paramsCopy.pp_SecureHash;

    // Include all pp_* AND ppmpf_* fields with non-empty values
    // (matching the CalculateHash function from JazzCash's test form)
    const sortedKeys = Object.keys(paramsCopy)
        .filter(k => {
            if (k === 'pp_SecureHash') return false;
            return (k.startsWith('pp_') || k.startsWith('ppmpf_'))
                && paramsCopy[k] !== ''
                && paramsCopy[k] != null;
        })
        .sort();

    const hashString = integrityKey + '&' + sortedKeys.map(k => paramsCopy[k]).join('&');

    const hash = crypto
        .createHmac('sha256', integrityKey)
        .update(hashString, 'utf-8')
        .digest('hex');

    if (JAZZCASH_DEBUG) {
        console.log('\n=== JAZZCASH HASH DEBUG ===');
        console.log('Sorted keys:', sortedKeys.join(', '));
        console.log('Raw hash input:');
        console.log(hashString);
        console.log('Computed hash (hex):', hash);
        console.log('Integrity key (first 4+last 4 chars):', integrityKey.slice(0, 4) + '...' + integrityKey.slice(-4));
        console.log('==========================\n');
    }

    return hash;
}

function verifyCallbackHash(params) {
    try {
        const { integrityKey } = getCreds();
        const receivedHash = params.pp_SecureHash;
        const expectedHash = generateSecureHash(params, integrityKey);
        return receivedHash === expectedHash;
    } catch (err) {
        console.error('JazzCash hash verification error:', err.message);
        return false;
    }
}

// ── Transaction Reference ──────────────────────────────────────────
function generateTxnRef() {
    const now  = formatDateTime(new Date());
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'T' + now + rand;
}

// ── Amount Helpers ─────────────────────────────────────────────────
function toPaisas(amountRs) {
    return String(Math.round(Number(amountRs) * 100));
}

function fromPaisas(paisas) {
    return Number(paisas) / 100;
}

// ── Mobile Number Normalization ────────────────────────────────────
function normalizeMobile(number) {
    if (!number) return '';
    let n = String(number).trim().replace(/[\s-]/g, '');
    if (n.startsWith('+92')) n = '0' + n.slice(3);
    else if (n.startsWith('92') && n.length === 12) n = '0' + n.slice(2);
    return n;
}

// ═══════════════════════════════════════════════════════════════════
// Initiate DoMWalletTransaction
// ═══════════════════════════════════════════════════════════════════
async function initiateTransaction({
    mobileNumber,
    cnic,
    amountRs,
    billReference,
    description,
    txnRef
}) {
    let merchantId, password, integrityKey;
    try {
        ({ merchantId, password, integrityKey } = getCreds());
    } catch (credErr) {
        return {
            success        : false,
            responseCode   : 'CFG',
            responseMessage: 'JazzCash credentials not configured. Set JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, and JAZZCASH_INTEGRITY_KEY in .env.',
            txnRefNo       : txnRef || generateTxnRef(),
            rawResponse    : null
        };
    }

    const txnRefNo  = txnRef || generateTxnRef();
    const txnDT     = formatDateTime(new Date());
    const txnExpiry = getExpiryDateTime(60);
    const returnUrl = (process.env.APP_URL || 'http://localhost:3000') +
                      '/student/payments/jazzcash/callback';

    const safeDescription = (description || 'Hostel Payment')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/[<>\\*=%/:'\|"{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);

    const params = {
        pp_Version          : '1.1',
        pp_TxnType          : 'MWALLET',
        pp_Language         : 'EN',
        pp_MerchantID       : merchantId,
        pp_SubMerchantID    : '',
        pp_Password         : password,
        pp_BankID           : '',
        pp_ProductID        : '',
        pp_TxnRefNo         : txnRefNo,
        pp_Amount           : toPaisas(amountRs),
        pp_TxnCurrency      : 'PKR',
        pp_TxnDateTime      : txnDT,
        pp_BillReference    : String(billReference).substring(0, 20),
        pp_Description      : safeDescription,
        pp_TxnExpiryDateTime: txnExpiry,
        pp_ReturnURL        : returnUrl,
        pp_SecureHash       : '',
        pp_MobileNumber     : normalizeMobile(mobileNumber),
        pp_CNIC             : String(cnic || '').replace(/\D/g, ''),
        pp_UsageMode        : 'API',
        ppmpf_1             : normalizeMobile(mobileNumber),
        ppmpf_2             : '',
        ppmpf_3             : '',
        ppmpf_4             : '',
        ppmpf_5             : ''
    };

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
        const gatewayBody = err.response && err.response.data;
        console.error('JazzCash API error:', {
            message: err.message,
            status : err.response?.status,
            body   : gatewayBody
        });

        if (gatewayBody?.pp_ResponseCode || gatewayBody?.pp_ResponseMessage) {
            return {
                success        : gatewayBody.pp_ResponseCode === '000',
                responseCode   : gatewayBody.pp_ResponseCode || 'ERR',
                responseMessage: gatewayBody.pp_ResponseMessage || 'JazzCash returned an error.',
                txnRefNo       : gatewayBody.pp_TxnRefNo || txnRefNo,
                rawResponse    : gatewayBody
            };
        }

        return {
            success        : false,
            responseCode   : 'ERR',
            responseMessage: err.code === 'ECONNABORTED'
                ? 'JazzCash did not respond in time. Please try again.'
                : err.response
                    ? `JazzCash returned HTTP ${err.response.status}. Please try again.`
                    : 'Could not reach JazzCash. Check your network connection.',
            txnRefNo,
            rawResponse: gatewayBody || null
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
// Parse and validate callback from JazzCash
// ═══════════════════════════════════════════════════════════════════
function parseCallback(body) {
    return {
        isValid        : verifyCallbackHash(body),
        isSuccess      : body.pp_ResponseCode === '000',
        responseCode   : body.pp_ResponseCode,
        responseMessage: body.pp_ResponseMessage,
        txnRefNo       : body.pp_TxnRefNo,
        billReference  : body.pp_BillReference,
        amount         : body.pp_Amount ? fromPaisas(body.pp_Amount) : 0,
        authCode       : body.pp_AuthCode || null,
        rrn            : body.pp_RetreivalReferenceNo || null,
        mobileNumber   : body.ppmpf_1 || null,
        rawBody        : body
    };
}

// ═══════════════════════════════════════════════════════════════════
// Response Code Descriptions
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
    return RESPONSE_CODES[code] || null;
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