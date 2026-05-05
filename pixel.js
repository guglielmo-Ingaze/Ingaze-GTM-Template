/**
 * Ingaze Cloudflare Worker
 * Middleware for validating and forwarding tracking events to Bubble.io Data API
 */

// In-memory store for rate limiting (per Edge Node)
const rateLimiter = new Map();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 50;
const ALLOWED_EVENT_TYPES = ['page_view', 'job_click', 'apply_click', 'outbound_ats_click'];

// Headers for CORS and JSON responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Handle CORS Preflight requests
 */
function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
      },
    });
  }
}

/**
 * Rate limiting logic
 */
function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimiter.get(ip);

  if (!record) {
    rateLimiter.set(ip, { count: 1, timestamp: now });
    return false;
  }

  if (now - record.timestamp > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    rateLimiter.set(ip, { count: 1, timestamp: now });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true; // Rate limited
  }

  record.count++;
  rateLimiter.set(ip, record);
  return false;
}

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);

    // Gestione del redirect Outbound Tracking
    if (request.method === 'GET' && url.pathname === '/out') {
      return handleOutbound(request, env, ctx);
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    // 2. Rate Limiting Check
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // 3. Parse Payload (supports both application/json and text/plain from sendBeacon)
      let payload;
      try {
        const rawText = await request.text();
        payload = JSON.parse(rawText);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const {
        Workspace_ID,
        Event_Type,
        Session_ID,
        Page_URL,
        UTM_Source,
        Page_Type,
        Job_ID,
        Timestamp
      } = payload;

      if (!Workspace_ID || !Event_Type) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 4. Validate Event Type
      if (!ALLOWED_EVENT_TYPES.includes(Event_Type)) {
        return new Response(JSON.stringify({ error: 'Invalid Event Type' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 5. Validate Domain against KV Store
      const requestOrigin = request.headers.get('Origin') || new URL(request.headers.get('Referer') || Page_URL).origin;

      if (env.Workspace_id_binding) {
        // Assume KV contains a list of allowed origins as a JSON string for the given workspace ID
        const allowedOriginsStr = await env.Workspace_id_binding.get(Workspace_ID);

        if (!allowedOriginsStr) {
          return new Response(JSON.stringify({ error: 'Workspace Not Found' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          const rawOrigins = JSON.parse(allowedOriginsStr);
          // Estrai solo l'origin (pulendo path e slash finali) da tutti gli URL salvati
          const allowedOrigins = rawOrigins.map(url => {
            if (url === '*') return '*';
            try {
              return new URL(url).origin;
            } catch (err) {
              return url.replace(/\/$/, ''); // Fallback
            }
          });

          if (!allowedOrigins.includes(requestOrigin) && !allowedOrigins.includes('*')) {
            return new Response(JSON.stringify({ error: 'Origin not allowed for this workspace' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (e) {
          // If the KV value isn't JSON, treat it as a single string and clean it
          let cleanedAllowedOrigin = allowedOriginsStr;
          if (allowedOriginsStr !== '*') {
            try {
              cleanedAllowedOrigin = new URL(allowedOriginsStr).origin;
            } catch (err) {
              cleanedAllowedOrigin = allowedOriginsStr.replace(/\/$/, '');
            }
          }

          if (cleanedAllowedOrigin !== requestOrigin && cleanedAllowedOrigin !== '*') {
            return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } else {
        console.warn('INGAZE_WORKSPACES KV not bound. Skipping domain validation.');
      }

      // 6. Forward to Bubble Data API
      // We map the payload directly to the fields expected by Bubble.
      // Note: In Bubble, field names should match exactly what's configured in the Data Type (often lowercase without spaces).
      const bubblePayload = {
        workspace_id: Workspace_ID,
        event_type: Event_Type,
        session_id: Session_ID,
        page_url: Page_URL,
        utm_source: UTM_Source,
        page_type: Page_Type || null,
        job_id: Job_ID || null,
        timestamp_string: Timestamp || new Date().toISOString()
      };

      const bubbleResponse = await fetch('https://app.ingaze.ai/version-test/api/1.1/obj/cwc_events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.BUBBLE_API_TOKEN}`
        },
        body: JSON.stringify(bubblePayload)
      });

      if (!bubbleResponse.ok) {
        const errorText = await bubbleResponse.text();
        console.error('Bubble Error:', errorText);
        return new Response(JSON.stringify({ error: 'Failed to save event to database' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ✅ Success!
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Worker Error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

async function handleOutbound(request, env, ctx) {
  const url = new URL(request.url);

  const to = url.searchParams.get('to');
  const wid = url.searchParams.get('wid');
  const sid = url.searchParams.get('sid');
  const jid = url.searchParams.get('jid');
  const utm = url.searchParams.get('utm');

  if (!to) {
    return new Response('Missing destination', { status: 400 });
  }

  const decodedTo = decodeURIComponent(to);

  // --- Deduplication (Server-side via Cache API) ---
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  
  // Finestra di 5 secondi per la deduplicazione
  const dedupeKey = await hash(`${ip}|${ua}|${decodedTo}|${jid}|${Math.floor(Date.now()/5000)}`);
  
  // Usiamo Cache API per deduplicazione (free & fast)
  const cache = caches.default;
  const cacheUrl = new URL(`https://dedupe.internal/${dedupeKey}`);
  const cacheRequest = new Request(cacheUrl);
  const alreadySeen = await cache.match(cacheRequest);

  if (!alreadySeen) {
    // Salviamo in cache (simula TTL)
    const responseToCache = new Response('1', {
      headers: { 'Cache-Control': 'max-age=5' }
    });
    // Fire and forget cache put
    ctx.waitUntil(cache.put(cacheRequest, responseToCache));

    const timestamp = new Date().toISOString();

    const bubblePayload = {
        workspace_id: wid,
        event_type: 'outbound_ats_click',
        session_id: sid,
        page_url: decodedTo,
        utm_source: utm,
        page_type: null,
        job_id: jid || null,
        timestamp_string: timestamp
    };

    // Fire and forget event to Bubble.io
    const sendEvent = async () => {
      try {
        if (env.Workspace_id_binding && wid) {
            const allowedOriginsStr = await env.Workspace_id_binding.get(wid);
            if (!allowedOriginsStr) return; // Invalid workspace
        }
        
        const bubbleResponse = await fetch('https://app.ingaze.ai/version-test/api/1.1/obj/cwc_events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.BUBBLE_API_TOKEN}`
          },
          body: JSON.stringify(bubblePayload)
        });
        if (!bubbleResponse.ok) console.error('Bubble Error:', await bubbleResponse.text());
      } catch (e) {
        console.error('Fetch Error:', e);
      }
    };
    
    ctx.waitUntil(sendEvent());
  }

  // Redirect immediately
  return Response.redirect(decodedTo, 302);
}

// Simple hash helper per deduplication
async function hash(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
