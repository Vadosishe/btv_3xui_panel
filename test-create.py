import sys
import json
import urllib.request
import urllib.error

def main():
    if len(sys.argv) < 2:
        print("Usage: python test-create.py <apiUrl> [apiPassword]")
        print("Example: python test-create.py http://194.87.202.225:51821 myPassword")
        sys.exit(1)

    api_url = sys.argv[1].rstrip('/')
    password = sys.argv[2] if len(sys.argv) > 2 else ""

    print(f"\n==========================================")
    print(f"Testing Amnezia WG-Easy API")
    print(f"Server: {api_url}")
    print(f"==========================================\n")

    # 1. Login to get the cookie
    login_url = f"{api_url}/api/session"
    login_data = json.dumps({"password": password}).encode('utf-8')
    
    req = urllib.request.Request(
        login_url,
        data=login_data,
        headers={"Content-Type": "application/json"}
    )
    
    cookie = None
    try:
        print(f"Sending POST to {login_url}...")
        with urllib.request.urlopen(req) as response:
            status = response.getcode()
            headers = response.info()
            body = response.read().decode('utf-8')
            
            print(f"Login Response Status: {status}")
            print(f"Login Response Body: {body}")
            
            set_cookie = headers.get('Set-Cookie')
            if set_cookie:
                print(f"Found Set-Cookie: {set_cookie}")
                # Parse connect.sid
                for item in set_cookie.split(';'):
                    if 'connect.sid' in item:
                        cookie = item.strip()
                        break
            else:
                print("Warning: No Set-Cookie header found in login response!")
    except urllib.error.HTTPError as e:
        print(f"Login HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}")
        sys.exit(1)
    except Exception as e:
        print(f"Login Connection Error: {e}")
        sys.exit(1)

    if not cookie:
        print("Could not obtain connect.sid cookie. Attempting subsequent requests without cookie...")
    else:
        print(f"Successfully obtained session cookie: {cookie}\n")

    # Helper function for requests
    def make_request(path, method='GET', body_dict=None):
        url = f"{api_url}{path}"
        headers = {"Accept": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
            
        data = None
        if body_dict is not None:
            data = json.dumps(body_dict).encode('utf-8')
            headers["Content-Type"] = "application/json"
            
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            print(f"--- Sending {method} to {url} ---")
            if body_dict:
                print(f"Request Body: {json.dumps(body_dict)}")
            with urllib.request.urlopen(req) as response:
                status = response.getcode()
                resp_headers = response.info()
                resp_body = response.read().decode('utf-8')
                print(f"Response Status: {status}")
                print(f"Response Body: {resp_body}")
                try:
                    return json.loads(resp_body)
                except:
                    return resp_body
        except urllib.error.HTTPError as e:
            print(f"HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}")
            return None
        except Exception as e:
            print(f"Error: {e}")
            return None

    # 2. Try to GET current clients (Nuxt API)
    print("\n--- Listing clients (Nuxt API: GET /api/wireguard/client) ---")
    clients_nuxt = make_request("/api/wireguard/client", "GET")

    # 3. Try to GET current clients (Express API)
    print("\n--- Listing clients (Express API: GET /api/peers) ---")
    clients_express = make_request("/api/peers", "GET")

    # 4. Try to POST a test client (Nuxt API)
    test_email = "test-amnezia-client-123@btv.vpn"
    print(f"\n--- Creating test client (Nuxt API: POST /api/wireguard/client) ---")
    post_nuxt = make_request("/api/wireguard/client", "POST", {"name": test_email})

    # 5. Try to POST a test client (Express API)
    test_email_express = "test-amnezia-client-express@btv.vpn"
    print(f"\n--- Creating test client (Express API: POST /api/peers) ---")
    post_express = make_request("/api/peers", "POST", {"name": test_email_express})

    print(f"\n==========================================")
    print(f"Diagnostics complete.")
    print(f"==========================================")

if __name__ == "__main__":
    main()
