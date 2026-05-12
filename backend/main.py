from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import json

from pdf_manager import merge_pdfs, generate_thumbnails, apply_annotations_and_rearrange, convert_to_pptx
from typing import List, Optional
from supabase_client import upload_to_supabase, download_from_supabase

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use a temporary local directory for processing
UPLOAD_DIR = "/tmp/uploads" if os.name != 'nt' else "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload")
async def upload_pdfs(files: List[UploadFile] = File(...), session_id: Optional[str] = Form(None)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    
    if not session_id:
        session_id = str(uuid.uuid4())
    
    session_dir = os.path.join(UPLOAD_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    saved_paths = []
    merged_path = os.path.join(session_dir, "merged.pdf")
    
    # Check if a merged.pdf already exists locally, if not try downloading from Supabase
    if not os.path.exists(merged_path):
        download_from_supabase(f"{session_id}/merged.pdf", merged_path)
        
    if os.path.exists(merged_path):
        saved_paths.append(merged_path)
        
    start_idx = len(saved_paths)
    for idx, file in enumerate(files):
        path = os.path.join(session_dir, f"input_{start_idx + idx}.pdf")
        with open(path, "wb") as f:
            f.write(await file.read())
        saved_paths.append(path)
        
    # Merge all (existing merged + new files)
    temp_merged = os.path.join(session_dir, "temp_merged.pdf")
    merge_pdfs(saved_paths, temp_merged)
    
    # Replace old merged.pdf with new one
    if os.path.exists(merged_path):
        os.remove(merged_path)
    os.rename(temp_merged, merged_path)
    
    # Backup the merged PDF to Supabase
    upload_to_supabase(merged_path, f"{session_id}/merged.pdf")
    
    thumbnails = generate_thumbnails(merged_path)
    
    return {"session_id": session_id, "thumbnails": thumbnails}

@app.post("/process")
async def process_pdf(
    session_id: str = Form(...),
    new_order: str = Form(...),
    annotations: str = Form("[]"),
    output_format: str = Form(...)
):
    session_dir = os.path.join(UPLOAD_DIR, session_id)
    merged_path = os.path.join(session_dir, "merged.pdf")
    
    if not os.path.exists(merged_path):
        # Try downloading from Supabase
        if not download_from_supabase(f"{session_id}/merged.pdf", merged_path):
            raise HTTPException(status_code=404, detail="Session not found")
        
    try:
        order_list = json.loads(new_order)
        order_list = [int(i) for i in order_list]
        anns_list = json.loads(annotations)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid data")
        
    rearranged_pdf_path = os.path.join(session_dir, "rearranged.pdf")
    apply_annotations_and_rearrange(merged_path, order_list, anns_list, rearranged_pdf_path)
    
    # Save the new version as the primary merged PDF so subsequent edits build on it
    os.replace(rearranged_pdf_path, merged_path)
    upload_to_supabase(merged_path, f"{session_id}/merged.pdf")
    
    if output_format.lower() == "pptx":
        out_path = os.path.join(session_dir, "output.pptx")
        convert_to_pptx(merged_path, out_path)
        media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        filename = "converted.pptx"
    else:
        out_path = merged_path
        media_type = "application/pdf"
        filename = "processed.pdf"
        
    if not os.path.exists(out_path):
        raise HTTPException(status_code=500, detail="Failed to generate file")
        
    return FileResponse(out_path, media_type=media_type, filename=filename)

import fitz
import base64

@app.post("/update_thumbnail")
async def update_thumbnail(
    session_id: str = Form(...),
    page_index: int = Form(...),
    annotations: str = Form(...)
):
    session_dir = os.path.join(UPLOAD_DIR, session_id)
    merged_path = os.path.join(session_dir, "merged.pdf")
    
    if not os.path.exists(merged_path):
        # Try downloading from Supabase
        if not download_from_supabase(f"{session_id}/merged.pdf", merged_path):
            raise HTTPException(status_code=404, detail="Session not found")
        
    try:
        ann_list = json.loads(annotations)
    except:
        ann_list = []
        
    from pdf_manager import apply_annotations_to_page
    
    doc = fitz.open(merged_path)
    if page_index < 0 or page_index >= len(doc):
        raise HTTPException(status_code=400, detail="Invalid page index")
        
    page = doc[page_index]
    apply_annotations_to_page(page, ann_list)
    
    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
    img_data = pix.tobytes("png")
    b64 = base64.b64encode(img_data).decode("utf-8")
    doc.close()
    
    return {"data": f"data:image/png;base64,{b64}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
