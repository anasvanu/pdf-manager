import os
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
BUCKET_NAME = "pdfs"

def get_headers():
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY
    }

def upload_to_supabase(local_file_path: str, remote_storage_path: str, content_type: str = "application/pdf"):
    """Uploads a local file to Supabase storage."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
        
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{remote_storage_path}"
    headers = get_headers()
    headers["Content-Type"] = content_type
    
    with open(local_file_path, "rb") as f:
        response = requests.post(url, headers=headers, data=f)
        
    # If file already exists, we might need to use PUT or just ignore
    if response.status_code == 400 and "Duplicate" in response.text:
        # Try updating it
        response = requests.put(url, headers=headers, data=open(local_file_path, "rb"))
        
    return response.status_code in [200, 201]

def download_from_supabase(remote_storage_path: str, local_file_path: str):
    """Downloads a file from Supabase storage to a local path."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
        
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{remote_storage_path}"
    headers = get_headers()
    
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        os.makedirs(os.path.dirname(local_file_path), exist_ok=True)
        with open(local_file_path, "wb") as f:
            f.write(response.content)
        return True
    return False
