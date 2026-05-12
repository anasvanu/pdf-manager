import React, { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { UploadCloud, FileText, Download, X, RefreshCw, Edit2, Plus, Type, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Pipette, Undo, Redo, Save, Underline, Square, Circle, Image as ImageIcon } from 'lucide-react';
import { Rnd } from 'react-rnd';

const API_BASE = 'http://localhost:8000';

function SortableItem({ id, url, index, originalIndex, pageData, onRemove, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="thumbnail-wrapper">
      <img src={url} alt={`Page ${originalIndex + 1}`} className="thumbnail-image" />
      <div className="page-number">{index + 1}</div>
      <button className="edit-btn" onPointerDown={(e) => { e.stopPropagation(); onEdit(pageData); }}>
        <Edit2 size={14} /> Edit
      </button>
      <button className="delete-btn" onPointerDown={(e) => { e.stopPropagation(); onRemove(id); }}>
        <X size={16} />
      </button>
    </div>
  );
}

function App() {
  const [pages, setPages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);
  
  const [annotations, setAnnotations] = useState({});
  const [editingPage, setEditingPage] = useState(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef(null);

  // Undo / Redo & Selection state
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragOver = (e) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragActive(false); };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const uploadFiles = async (files) => {
    setLoading(true);
    setLoadingMsg('Merging and generating thumbnails...');
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));
    if (sessionId) {
      formData.append('session_id', sessionId);
    }

    try {
      const response = await axios.post(`${API_BASE}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSessionId(response.data.session_id);
      setPages(response.data.thumbnails);
    } catch (error) {
      alert('Failed to upload files.');
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setPages(items => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const processFile = async (format) => {
    setLoading(true);
    setLoadingMsg(`Generating ${format.toUpperCase()}...`);
    
    const newOrder = pages.map(p => p.originalIndex);
    const flatAnnotations = [];
    Object.keys(annotations).forEach(pageIndex => {
      annotations[pageIndex].forEach(ann => {
        flatAnnotations.push({ pageIndex: parseInt(pageIndex), ...ann });
      });
    });

    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('new_order', JSON.stringify(newOrder));
    formData.append('annotations', JSON.stringify(flatAnnotations));
    formData.append('output_format', format);

    try {
      const response = await axios.post(`${API_BASE}/process`, formData, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `document.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      alert('Failed to generate output file.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (editingPage && containerRef.current) {
      const updateScale = () => {
        const containerWidth = containerRef.current.clientWidth - 40;
        const containerHeight = containerRef.current.clientHeight - 40;
        const scaleX = containerWidth / editingPage.width;
        const scaleY = containerHeight / editingPage.height;
        setScale(Math.min(scaleX, scaleY, 1.5));
      };
      updateScale();
      window.addEventListener('resize', updateScale);
      return () => window.removeEventListener('resize', updateScale);
    }
  }, [editingPage]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!editingPage) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) { e.preventDefault(); handleRedo(); }
        else { e.preventDefault(); handleUndo(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault(); handleRedo();
      }
    };

    const handlePaste = (e) => {
      if (!editingPage) return;
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            addImageAnnotation(event.target.result);
          };
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [editingPage, undoHistory, redoHistory]);

  const pushHistory = (newState) => {
    const currState = annotations[editingPage.originalIndex] || [];
    setUndoHistory(prev => [...prev, currState]);
    setRedoHistory([]);
    setAnnotations(prev => ({ ...prev, [editingPage.originalIndex]: newState }));
  };

  const handleUndo = () => {
    if (undoHistory.length === 0) return;
    const previousState = undoHistory[undoHistory.length - 1];
    const currState = annotations[editingPage.originalIndex] || [];
    
    setUndoHistory(prev => prev.slice(0, -1));
    setRedoHistory(prev => [...prev, currState]);
    setAnnotations(prev => ({ ...prev, [editingPage.originalIndex]: previousState }));
  };

  const handleRedo = () => {
    if (redoHistory.length === 0) return;
    const nextState = redoHistory[redoHistory.length - 1];
    const currState = annotations[editingPage.originalIndex] || [];
    
    setRedoHistory(prev => prev.slice(0, -1));
    setUndoHistory(prev => [...prev, currState]);
    setAnnotations(prev => ({ ...prev, [editingPage.originalIndex]: nextState }));
  };

  const createBaseAnnotation = () => ({
    id: Date.now(), x: 50, y: 50, color: '#000000', bgColor: 'transparent',
    borderColor: 'transparent', borderWidth: 0
  });

  const addTextAnnotation = () => {
    const ann = {
      ...createBaseAnnotation(), type: 'text', width: 200, height: 60,
      text: 'Editable Text', size: 16, bold: false, italic: false, underline: false, align: 'left',
      fontFamily: editingPage.suggestedFont || 'Helvetica'
    };
    pushHistory([...(annotations[editingPage.originalIndex] || []), ann]);
    setSelectedId(ann.id);
  };

  const addShapeAnnotation = (shapeType) => {
    const ann = {
      ...createBaseAnnotation(), type: shapeType, width: 100, height: 100,
      color: '#000000', borderColor: '#000000', borderWidth: 2
    };
    pushHistory([...(annotations[editingPage.originalIndex] || []), ann]);
    setSelectedId(ann.id);
  };

  const addImageAnnotation = (dataUrl) => {
    const img = new window.Image();
    img.onload = () => {
      const ann = {
        ...createBaseAnnotation(), type: 'image', width: img.width > 300 ? 300 : img.width, height: img.width > 300 ? (img.height * (300/img.width)) : img.height,
        data: dataUrl
      };
      pushHistory([...(annotations[editingPage.originalIndex] || []), ann]);
      setSelectedId(ann.id);
    };
    img.src = dataUrl;
  };

  const updateAnnotation = (id, updates, commitHistory = false) => {
    const currState = annotations[editingPage.originalIndex] || [];
    const newState = currState.map(ann => ann.id === id ? { ...ann, ...updates } : ann);
    if (commitHistory) pushHistory(newState);
    else setAnnotations(prev => ({ ...prev, [editingPage.originalIndex]: newState }));
  };

  const removeAnnotation = (id) => {
    const currState = annotations[editingPage.originalIndex] || [];
    pushHistory(currState.filter(a => a.id !== id));
  };

  const openEditor = (pageData) => {
    setEditingPage(pageData);
    setUndoHistory([]);
    setRedoHistory([]);
    setSelectedId(null);
  };

  const saveAndClose = async () => {
    const pageData = editingPage;
    const pageAnns = annotations[pageData.originalIndex] || [];
    setEditingPage(null); // Close modal immediately
    
    // Call backend to update thumbnail for this page
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('page_index', pageData.originalIndex);
    formData.append('annotations', JSON.stringify(pageAnns));
    
    try {
      const res = await axios.post(`${API_BASE}/update_thumbnail`, formData);
      // Replace the thumbnail in pages array
      setPages(prev => prev.map(p => p.originalIndex === pageData.originalIndex ? { ...p, data: res.data.data } : p));
    } catch (e) {
      console.error("Failed to update thumbnail", e);
    }
  };

  const pickColor = async (id, type) => {
    if (!window.EyeDropper) { alert("Your browser does not support the EyeDropper API."); return; }
    const eyeDropper = new window.EyeDropper();
    try {
      const result = await eyeDropper.open();
      updateAnnotation(id, { [type]: result.sRGBHex }, true);
    } catch (e) { }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>PDF Manager Pro</h1>
        <p>WYSIWYG Editor with Live Updates & Shapes</p>
      </div>

      <div className="glass-panel">
        {loading ? (
          <div className="loader-container">
            <div className="spinner"></div>
            <p style={{ color: 'var(--text-muted)' }}>{loadingMsg}</p>
          </div>
        ) : !sessionId ? (
          <div className={`upload-zone ${dragActive ? 'drag-active' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => document.getElementById('fileUpload').click()}>
            <UploadCloud className="upload-icon" />
            <h3 className="upload-text">Drag & Drop PDF files here</h3>
            <p className="upload-subtext">or click to browse from your computer</p>
            <input id="fileUpload" type="file" multiple accept=".pdf" onChange={(e) => uploadFiles(e.target.files)} />
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>Arrange & Edit Pages</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={() => document.getElementById('addFiles').click()}>
                  <Plus size={18} /> Add More PDFs
                </button>
                <input id="addFiles" type="file" multiple accept=".pdf" style={{display:'none'}} onChange={(e) => uploadFiles(e.target.files)} />
                <button className="btn btn-secondary" onClick={() => { setPages([]); setSessionId(null); setAnnotations({}); }}>
                  <RefreshCw size={18} /> Start Over
                </button>
              </div>
            </div>
            
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}>
                <div className="grid">
                  {pages.map((page, index) => (
                    <SortableItem key={page.id} id={page.id} url={page.data} index={index} originalIndex={page.originalIndex} pageData={page} onRemove={removePage => setPages(p => p.filter(x => x.id !== removePage))} onEdit={openEditor} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="actions">
              <button className="btn btn-secondary" onClick={() => processFile('pdf')} disabled={pages.length === 0}>
                <FileText size={20} /> Download PDF
              </button>
              <button className="btn" onClick={() => processFile('pptx')} disabled={pages.length === 0}>
                <Download size={20} /> Download PPTX
              </button>
            </div>
          </div>
        )}
      </div>

      {editingPage && (
        <div className="modal-backdrop" onClick={() => setSelectedId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '95vw', height: '95vh', display:'flex', flexDirection:'column' }}>
            <div className="modal-header">
              <div style={{display:'flex', gap:'1rem', alignItems:'center'}}>
                <h3>Editor</h3>
                <button className="icon-btn" onClick={handleUndo} disabled={undoHistory.length===0} title="Undo (Ctrl+Z)"><Undo size={20}/></button>
                <button className="icon-btn" onClick={handleRedo} disabled={redoHistory.length===0} title="Redo (Ctrl+Y)"><Redo size={20}/></button>
              </div>
              <div style={{display: 'flex', gap: '1rem', alignItems:'center'}}>
                <button className="btn btn-secondary" onClick={addTextAnnotation}><Type size={18} /> Text</button>
                <div style={{position: 'relative'}}>
                  <button className="btn btn-secondary" onClick={() => {
                    const el = document.getElementById('shapesMenu');
                    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                  }}>
                    <Square size={18} /> Shapes
                  </button>
                  <div id="shapesMenu" style={{display: 'none', position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #ccc', borderRadius: '4px', flexDirection: 'column', zIndex: 300, minWidth: '100px', marginTop: '4px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'}}>
                    <button style={{padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left'}} onClick={() => {addShapeAnnotation('rect'); document.getElementById('shapesMenu').style.display='none';}}>Rectangle</button>
                    <button style={{padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left'}} onClick={() => {addShapeAnnotation('circle'); document.getElementById('shapesMenu').style.display='none';}}>Circle</button>
                    <button style={{padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left'}} onClick={() => {addShapeAnnotation('triangle'); document.getElementById('shapesMenu').style.display='none';}}>Triangle</button>
                    <button style={{padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left'}} onClick={() => {addShapeAnnotation('line'); document.getElementById('shapesMenu').style.display='none';}}>Line</button>
                  </div>
                </div>
                <button className="btn btn-secondary" onClick={() => document.getElementById('imageUpload').click()}><ImageIcon size={18} /> Image</button>
                <input id="imageUpload" type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const r = new FileReader();
                    r.onload = ev => addImageAnnotation(ev.target.result);
                    r.readAsDataURL(e.target.files[0]);
                  }
                }} />
                
                <div style={{width:'1px', background:'#eee', height:'24px', margin:'0 1rem'}}></div>
                <button className="btn" onClick={saveAndClose}><Save size={18} /> Save & Close</button>
              </div>
            </div>
            
            <div className="modal-body" onClick={() => setSelectedId(null)} style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div className="editor-preview" ref={containerRef} style={{ overflow: 'hidden' }}>
                <div 
                  className="canvas-board" 
                  style={{
                    position: 'relative', width: `${editingPage.width}px`, height: `${editingPage.height}px`,
                    transform: `scale(${scale})`, transformOrigin: 'center center',
                    boxShadow: '0 0 20px rgba(0,0,0,0.5)', backgroundColor: 'white'
                  }}
                >
                  <img src={editingPage.data} alt="PDF Page" style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
                  
                  {(annotations[editingPage.originalIndex] || []).map((ann) => {
                    const isSelected = selectedId === ann.id;
                    return (
                      <Rnd
                        key={ann.id}
                        bounds="parent"
                        size={{ width: ann.width, height: ann.height }}
                        position={{ x: ann.x, y: ann.y }}
                        onDragStart={() => setSelectedId(ann.id)}
                        onDragStop={(e, d) => updateAnnotation(ann.id, { x: d.x, y: d.y }, true)}
                        onResizeStart={() => setSelectedId(ann.id)}
                        onResizeStop={(e, dir, ref, delta, pos) => {
                          updateAnnotation(ann.id, { width: ref.offsetWidth, height: ref.offsetHeight, ...pos }, true);
                        }}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          border: isSelected ? '2px dashed var(--primary)' : (ann.borderWidth && ann.type !== 'triangle' && ann.type !== 'line' ? `${ann.borderWidth}px solid ${ann.borderColor}` : 'none'),
                          backgroundColor: ann.bgColor === 'transparent' ? 'rgba(0,0,0,0.01)' : ann.bgColor,
                          borderRadius: ann.type === 'circle' ? '50%' : '0',
                          padding: ann.type === 'text' ? '2px' : '0',
                          zIndex: isSelected ? 110 : 100,
                          cursor: isSelected ? 'move' : 'pointer'
                        }}
                        onPointerDown={(e) => { e.stopPropagation(); setSelectedId(ann.id); }}
                      >
                        {isSelected && (
                          <div className="rnd-toolbar" style={{ display: 'flex', gap: '4px', marginBottom: '2px', background: 'rgba(0,0,0,0.85)', padding: '6px', borderRadius: '4px', transform: 'translateY(-100%)', position: 'absolute', top: '-6px', left: 0, whiteSpace: 'nowrap', zIndex: 120 }}>
                            {ann.type === 'text' && (
                              <>
                                <select value={ann.fontFamily} onChange={e => updateAnnotation(ann.id, {fontFamily: e.target.value}, true)} style={{fontSize:'12px', maxWidth: '80px'}}>
                                  <option value="Helvetica">Helvetica</option>
                                  <option value="Times-Roman">Times</option>
                                  <option value="Courier">Courier</option>
                                </select>
                                <input type="number" value={ann.size} onChange={e => updateAnnotation(ann.id, {size: parseInt(e.target.value)||10}, true)} style={{width: '40px', fontSize:'12px'}} title="Font Size"/>
                                
                                <div style={{display:'flex', alignItems:'center', background:'white', borderRadius:'2px', padding:'0 2px'}}>
                                  <input type="color" value={ann.color} onChange={e => updateAnnotation(ann.id, {color: e.target.value})} onBlur={(e) => updateAnnotation(ann.id, {color: e.target.value}, true)} style={{width: '20px', height: '20px', padding: 0, border:'none'}} title="Text Color"/>
                                  <button onClick={() => pickColor(ann.id, 'color')} style={{background:'none', border:'none', cursor:'pointer'}}><Pipette size={12} color="black"/></button>
                                </div>
                              </>
                            )}
                            
                            {['rect', 'circle', 'triangle', 'line'].includes(ann.type) && (
                              <div style={{display:'flex', alignItems:'center', background:'white', borderRadius:'2px', padding:'0 2px'}}>
                                <input type="color" value={ann.color} onChange={e => updateAnnotation(ann.id, {color: e.target.value})} onBlur={(e) => updateAnnotation(ann.id, {color: e.target.value}, true)} style={{width: '20px', height: '20px', padding: 0, border:'none'}} title={ann.type === 'line' ? "Line Color" : "Border Color"}/>
                                <button onClick={() => pickColor(ann.id, 'color')} style={{background:'none', border:'none', cursor:'pointer'}}><Pipette size={12} color="black"/></button>
                              </div>
                            )}

                            {ann.type !== 'image' && ann.type !== 'line' && (
                              <>
                                <select value={ann.bgColor} onChange={e => updateAnnotation(ann.id, {bgColor: e.target.value}, true)} style={{fontSize:'12px', maxWidth: '80px'}}>
                                  <option value="transparent">Clear BG</option>
                                  <option value="#FFFFFF">White Fill</option>
                                </select>
                                <div style={{display:'flex', alignItems:'center', background:'white', borderRadius:'2px', padding:'0 2px'}}>
                                  <input type="color" value={ann.bgColor !== 'transparent' && ann.bgColor !== '#FFFFFF' ? ann.bgColor : '#000000'} onChange={e => updateAnnotation(ann.id, {bgColor: e.target.value})} onBlur={(e) => updateAnnotation(ann.id, {bgColor: e.target.value}, true)} style={{width: '20px', height: '20px', padding: 0, border:'none'}} title="Fill Color"/>
                                  <button onClick={() => pickColor(ann.id, 'bgColor')} style={{background:'none', border:'none', cursor:'pointer'}}><Pipette size={12} color="black"/></button>
                                </div>
                              </>
                            )}
                            {ann.type !== 'image' && ann.type !== 'text' && (
                                <input type="number" value={ann.borderWidth} onChange={e => updateAnnotation(ann.id, {borderWidth: parseInt(e.target.value)||0}, true)} style={{width: '40px', fontSize:'12px'}} title="Border Width"/>
                            )}
                            {ann.type === 'text' && (
                              <>
                                <div style={{display:'flex', alignItems:'center', background:'white', borderRadius:'2px', padding:'0 2px'}}>
                                  <input type="color" value={ann.borderColor} onChange={e => updateAnnotation(ann.id, {borderColor: e.target.value})} onBlur={(e) => updateAnnotation(ann.id, {borderColor: e.target.value}, true)} style={{width: '20px', height: '20px', padding: 0, border:'none'}} title="Border Color"/>
                                  <button onClick={() => pickColor(ann.id, 'borderColor')} style={{background:'none', border:'none', cursor:'pointer'}}><Pipette size={12} color="black"/></button>
                                </div>
                                <input type="number" value={ann.borderWidth} onChange={e => updateAnnotation(ann.id, {borderWidth: parseInt(e.target.value)||0}, true)} style={{width: '40px', fontSize:'12px'}} title="Border Width"/>
                              </>
                            )}
                            
                            {ann.type === 'text' && (
                              <>
                                <div style={{width:'1px', background:'gray', margin:'0 2px'}}></div>
                                <button onClick={() => updateAnnotation(ann.id, {bold: !ann.bold}, true)} style={{background: ann.bold ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><Bold size={14} color={ann.bold ? 'white' : 'black'}/></button>
                                <button onClick={() => updateAnnotation(ann.id, {italic: !ann.italic}, true)} style={{background: ann.italic ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><Italic size={14} color={ann.italic ? 'white' : 'black'}/></button>
                                <button onClick={() => updateAnnotation(ann.id, {underline: !ann.underline}, true)} style={{background: ann.underline ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><Underline size={14} color={ann.underline ? 'white' : 'black'}/></button>
                                
                                <div style={{width:'1px', background:'gray', margin:'0 2px'}}></div>
                                <button onClick={() => updateAnnotation(ann.id, {align: 'left'}, true)} style={{background: ann.align==='left' ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><AlignLeft size={14} color={ann.align==='left' ? 'white' : 'black'}/></button>
                                <button onClick={() => updateAnnotation(ann.id, {align: 'center'}, true)} style={{background: ann.align==='center' ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><AlignCenter size={14} color={ann.align==='center' ? 'white' : 'black'}/></button>
                                <button onClick={() => updateAnnotation(ann.id, {align: 'right'}, true)} style={{background: ann.align==='right' ? 'var(--primary)' : 'white', border:'none', cursor:'pointer', borderRadius:'2px'}}><AlignRight size={14} color={ann.align==='right' ? 'white' : 'black'}/></button>
                              </>
                            )}

                            <button onClick={() => removeAnnotation(ann.id)} style={{background: 'red', color: 'white', border: 'none', cursor: 'pointer', borderRadius:'2px', marginLeft:'4px'}}><X size={14}/></button>
                          </div>
                        )}
                        
                        {ann.type === 'text' && (
                          <textarea 
                            value={ann.text} 
                            onChange={e => updateAnnotation(ann.id, {text: e.target.value})}
                            onBlur={e => updateAnnotation(ann.id, {text: e.target.value}, true)}
                            style={{
                              flex: 1, width: '100%', height: '100%', background: 'transparent', border: 'none',
                              color: ann.color, fontSize: `${ann.size}px`, fontFamily: ann.fontFamily,
                              fontWeight: ann.bold ? 'bold' : 'normal', fontStyle: ann.italic ? 'italic' : 'normal',
                              textDecoration: ann.underline ? 'underline' : 'none', textAlign: ann.align,
                              resize: 'none', outline: 'none', overflow: 'hidden'
                            }}
                          />
                        )}
                        {ann.type === 'image' && (
                           <img src={ann.data} alt="uploaded" style={{width: '100%', height: '100%', pointerEvents:'none'}} />
                        )}
                        {ann.type === 'triangle' && (
                          <svg width="100%" height="100%" style={{position: 'absolute', top: 0, left: 0, pointerEvents: 'none'}}>
                            <polygon points={`0,${ann.height} ${ann.width/2},0 ${ann.width},${ann.height}`} fill={ann.bgColor === 'transparent' ? 'none' : ann.bgColor} stroke={ann.color} strokeWidth={ann.borderWidth || 1} />
                          </svg>
                        )}
                        {ann.type === 'line' && (
                          <svg width="100%" height="100%" style={{position: 'absolute', top: 0, left: 0, pointerEvents: 'none'}}>
                            <line x1="0" y1="0" x2={ann.width} y2={ann.height} stroke={ann.color} strokeWidth={ann.borderWidth || 2} />
                          </svg>
                        )}
                      </Rnd>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
