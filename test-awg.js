async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: node test-awg.js <apiUrl> [apiPassword]");
    console.log("Example: node test-awg.js http://194.87.202.225:51821 myPassword");
    return;
  }

  const cleanUrl = args[0].endsWith('/') ? args[0].slice(0, -1) : args[0];
  const apiPassword = args[1] || '';

  console.log(`\n========================================`);
  console.log(`Testing Server: ${cleanUrl}`);
  console.log(`========================================`);

  // Try authenticating
  console.log("1. Authenticating...");
  let sessionCookie = '';
  try {
    const loginRes = await fetch(`${cleanUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: apiPassword }),
    });

    console.log(`Login Status: ${loginRes.status}`);
    const text = await loginRes.text();
    console.log(`Login Response: ${text.slice(0, 200)}`);

    if (!loginRes.ok) {
      console.log(`Login failed with status ${loginRes.status}`);
      return;
    }

    const setCookie = loginRes.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/connect\.sid=[^;]+/);
      if (match) {
        sessionCookie = match[0];
        console.log(`Login Successful. Cookie: ${sessionCookie}`);
      }
    }
  } catch (err) {
    console.error(`Login request failed:`, err.message);
    return;
  }

  // List of candidate endpoints to check
  const endpoints = [
    '/api/peers',
    '/api/wireguard/client',
    '/api/wireguard/clients',
    '/api/clients',
    '/peers',
    '/clients'
  ];

  const headers = { 'Accept': 'application/json' };
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  for (const endpoint of endpoints) {
    console.log(`\nTesting GET ${endpoint}...`);
    try {
      const testRes = await fetch(`${cleanUrl}${endpoint}`, {
        method: 'GET',
        headers
      });

      console.log(`Status: ${testRes.status}`);
      const text = await testRes.text();
      console.log(`Response length: ${text.length} characters`);
      
      try {
        const json = JSON.parse(text);
        console.log(`Response is valid JSON!`);
        if (Array.isArray(json)) {
          console.log(`Found ${json.length} items.`);
          if (json.length > 0) {
            console.log(`First item keys:`, Object.keys(json[0]));
            console.log(`First item:`, JSON.stringify(json[0]).slice(0, 150));
          }
        } else {
          console.log(`Response keys:`, Object.keys(json));
          console.log(`Response preview:`, JSON.stringify(json).slice(0, 150));
        }
      } catch (e) {
        console.log(`Response is NOT JSON (or empty). Preview: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`Request to ${endpoint} failed:`, err.message);
    }
  }
}

main().catch(console.error);
