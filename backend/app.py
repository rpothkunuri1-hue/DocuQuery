import os
import json
import time
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename
import ollama
from pypdf import PdfReader
from docx import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from collections import defaultdict
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt'}
MAX_FILE_SIZE = 50 * 1024 * 1024

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

documents_store = {}
rate_limit_store = defaultdict(list)
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW = 60

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_rate_limit(identifier):
    now = datetime.now()
    cutoff = now - timedelta(seconds=RATE_LIMIT_WINDOW)
    
    rate_limit_store[identifier] = [
        timestamp for timestamp in rate_limit_store[identifier]
        if timestamp > cutoff
    ]
    
    if len(rate_limit_store[identifier]) >= RATE_LIMIT_REQUESTS:
        return False
    
    rate_limit_store[identifier].append(now)
    return True

def extract_text_from_pdf(file_path):
    try:
        reader = PdfReader(file_path)
        text_data = []
        for page_num, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            if text.strip():
                text_data.append({
                    'page': page_num,
                    'text': text.strip()
                })
        return text_data
    except Exception as e:
        raise Exception(f"Error extracting PDF: {str(e)}")

def extract_text_from_docx(file_path):
    try:
        doc = Document(file_path)
        text_data = []
        current_section = 1
        current_text = []
        paragraph_count = 0
        
        for para in doc.paragraphs:
            if para.text.strip():
                current_text.append(para.text.strip())
                paragraph_count += 1
                
                if paragraph_count >= 5:
                    text_data.append({
                        'section': current_section,
                        'text': '\n\n'.join(current_text)
                    })
                    current_section += 1
                    current_text = []
                    paragraph_count = 0
        
        if current_text:
            text_data.append({
                'section': current_section,
                'text': '\n\n'.join(current_text)
            })
        
        return text_data
    except Exception as e:
        raise Exception(f"Error extracting DOCX: {str(e)}")

def extract_text_from_txt(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
        
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        text_data = []
        
        if paragraphs:
            for i, para in enumerate(paragraphs, 1):
                text_data.append({
                    'lines': f"¶{i}",
                    'text': para
                })
        else:
            lines = text.split('\n')
            chunk_size = 15
            for i in range(0, len(lines), chunk_size):
                chunk_lines = lines[i:i + chunk_size]
                chunk_text = '\n'.join(chunk_lines).strip()
                if chunk_text:
                    text_data.append({
                        'lines': f"{i+1}-{min(i+chunk_size, len(lines))}",
                        'text': chunk_text
                    })
        
        return text_data
    except Exception as e:
        raise Exception(f"Error extracting TXT: {str(e)}")

def chunk_text_smart(text_data, file_type):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    
    chunks = []
    for item in text_data:
        text = item['text']
        split_texts = text_splitter.split_text(text)
        
        for chunk_text in split_texts:
            chunk = {
                'text': chunk_text,
                'metadata': {}
            }
            
            if file_type == 'pdf':
                chunk['metadata']['page'] = item['page']
            elif file_type == 'docx':
                chunk['metadata']['section'] = item['section']
            else:
                chunk['metadata']['lines'] = item['lines']
            
            chunks.append(chunk)
    
    return chunks

def generate_summary(text_data, model='llama2'):
    try:
        full_text = '\n'.join([item['text'] for item in text_data[:5]])
        
        if len(full_text) > 3000:
            full_text = full_text[:3000] + "..."
        
        prompt = f"""Provide a brief 2-sentence summary of this document:

{full_text}

Summary:"""
        
        response = ollama.chat(model=model, messages=[
            {'role': 'user', 'content': prompt}
        ])
        
        return response['message']['content'].strip()
    except:
        return None

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not supported. Please upload PDF, DOCX, or TXT files.'}), 400
    
    try:
        filename = secure_filename(file.filename)
        timestamp = int(time.time())
        unique_filename = f"{timestamp}_{filename}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(file_path)
        
        file_ext = filename.rsplit('.', 1)[1].lower()
        
        if file_ext == 'pdf':
            text_data = extract_text_from_pdf(file_path)
        elif file_ext == 'docx':
            text_data = extract_text_from_docx(file_path)
        else:
            text_data = extract_text_from_txt(file_path)
        
        chunks = chunk_text_smart(text_data, file_ext)
        
        doc_id = unique_filename
        documents_store[doc_id] = {
            'filename': filename,
            'file_type': file_ext,
            'chunks': chunks,
            'raw_text_data': text_data,
            'uploaded_at': timestamp
        }
        
        summary = generate_summary(text_data)
        
        response_data = {
            'success': True,
            'doc_id': doc_id,
            'filename': filename,
            'chunks_count': len(chunks)
        }
        
        if summary:
            response_data['summary'] = summary
        
        return jsonify(response_data)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/documents', methods=['GET'])
def get_documents():
    docs = [{
        'doc_id': doc_id,
        'filename': data['filename'],
        'file_type': data['file_type'],
        'chunks_count': len(data['chunks'])
    } for doc_id, data in documents_store.items()]
    
    docs.sort(key=lambda x: x['doc_id'], reverse=True)
    
    return jsonify({'documents': docs})

@app.route('/api/document/<doc_id>', methods=['GET'])
def get_document(doc_id):
    if doc_id not in documents_store:
        return jsonify({'error': 'Document not found'}), 404
    
    doc = documents_store[doc_id]
    return jsonify({
        'filename': doc['filename'],
        'file_type': doc['file_type'],
        'text_data': doc['raw_text_data']
    })

@app.route('/api/ask-stream', methods=['POST'])
def ask_question_stream():
    data = request.json
    question = data.get('question', '')
    doc_id = data.get('doc_id', '')
    model = data.get('model', 'llama2')
    context = data.get('context', [])
    
    client_ip = request.remote_addr
    if not check_rate_limit(client_ip):
        return jsonify({'error': 'Rate limit exceeded. Please try again later.'}), 429
    
    if not question:
        return jsonify({'error': 'Question is required'}), 400
    
    if not doc_id or doc_id not in documents_store:
        return jsonify({'error': 'Valid document ID is required'}), 400
    
    def generate():
        try:
            doc = documents_store[doc_id]
            chunks = doc['chunks']
            
            relevant_chunks = find_relevant_chunks_fast(question, chunks, model)
            
            if not relevant_chunks:
                yield f"data: {json.dumps({'token': 'I could not find relevant information in the document to answer this question.'})}\n\n"
                yield f"data: {json.dumps({'references': [], 'confidence': 'low'})}\n\n"
                return
            
            context_text = "\n\n".join([chunk['text'] for chunk in relevant_chunks[:3]])
            
            context_history = ""
            if context:
                context_history = "\n\nPrevious conversation:\n"
                for msg in context[-3:]:
                    context_history += f"Q: {msg['question']}\nA: {msg['answer']}\n\n"
            
            prompt = f"""Based on the following document excerpts, answer the question. Provide specific references to pages, sections, or line numbers.{context_history}

Document excerpts:
{context_text}

Question: {question}

Answer:"""
            
            stream = ollama.chat(
                model=model,
                messages=[{'role': 'user', 'content': prompt}],
                stream=True
            )
            
            for chunk in stream:
                if 'message' in chunk and 'content' in chunk['message']:
                    token = chunk['message']['content']
                    yield f"data: {json.dumps({'token': token})}\n\n"
            
            references = []
            for chunk in relevant_chunks[:3]:
                ref = {
                    'text': chunk['text'][:200] + '...' if len(chunk['text']) > 200 else chunk['text'],
                    'metadata': chunk['metadata']
                }
                references.append(ref)
            
            confidence = 'high' if len(relevant_chunks) >= 2 else 'medium'
            yield f"data: {json.dumps({'references': references, 'confidence': confidence})}\n\n"
            
        except Exception as e:
            error_msg = str(e)
            if 'model' in error_msg.lower() or 'not found' in error_msg.lower():
                yield f"data: {json.dumps({'error': f'Ollama model error: {error_msg}'})}\n\n"
            else:
                yield f"data: {json.dumps({'error': f'Error processing question: {error_msg}'})}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/ask-multi', methods=['POST'])
def ask_multi_document():
    data = request.json
    question = data.get('question', '')
    model = data.get('model', 'llama2')
    context = data.get('context', [])
    
    client_ip = request.remote_addr
    if not check_rate_limit(client_ip):
        return jsonify({'error': 'Rate limit exceeded. Please try again later.'}), 429
    
    if not question:
        return jsonify({'error': 'Question is required'}), 400
    
    if not documents_store:
        return jsonify({'error': 'No documents available'}), 400
    
    def generate():
        try:
            all_chunks = []
            doc_sources = {}
            
            for doc_id, doc in documents_store.items():
                for chunk in doc['chunks']:
                    chunk_with_source = chunk.copy()
                    chunk_with_source['source'] = doc['filename']
                    all_chunks.append(chunk_with_source)
                    doc_sources[doc['filename']] = doc['file_type']
            
            relevant_chunks = find_relevant_chunks_fast(question, all_chunks, model)
            
            if not relevant_chunks:
                yield f"data: {json.dumps({'token': 'I could not find relevant information across the documents to answer this question.'})}\n\n"
                yield f"data: {json.dumps({'references': [], 'confidence': 'low'})}\n\n"
                return
            
            context_text = "\n\n".join([
                f"[From {chunk.get('source', 'Unknown')}]: {chunk['text']}"
                for chunk in relevant_chunks[:5]
            ])
            
            context_history = ""
            if context:
                context_history = "\n\nPrevious conversation:\n"
                for msg in context[-3:]:
                    context_history += f"Q: {msg['question']}\nA: {msg['answer']}\n\n"
            
            prompt = f"""Based on the following excerpts from multiple documents, answer the question. Cite which document each piece of information comes from.{context_history}

Document excerpts:
{context_text}

Question: {question}

Answer:"""
            
            stream = ollama.chat(
                model=model,
                messages=[{'role': 'user', 'content': prompt}],
                stream=True
            )
            
            for chunk in stream:
                if 'message' in chunk and 'content' in chunk['message']:
                    token = chunk['message']['content']
                    yield f"data: {json.dumps({'token': token})}\n\n"
            
            references = []
            for chunk in relevant_chunks[:5]:
                ref = {
                    'text': chunk['text'][:200] + '...' if len(chunk['text']) > 200 else chunk['text'],
                    'metadata': chunk['metadata'],
                    'source': chunk.get('source', 'Unknown')
                }
                references.append(ref)
            
            confidence = 'high' if len(relevant_chunks) >= 3 else 'medium'
            yield f"data: {json.dumps({'references': references, 'confidence': confidence})}\n\n"
            
        except Exception as e:
            error_msg = str(e)
            yield f"data: {json.dumps({'error': f'Error processing question: {error_msg}'})}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

def find_relevant_chunks_fast(question, chunks, model):
    try:
        scored_chunks = []
        question_lower = question.lower()
        question_words = set(question_lower.split())
        
        for chunk in chunks:
            text_lower = chunk['text'].lower()
            chunk_words = set(text_lower.split())
            
            keyword_overlap = len(question_words & chunk_words)
            
            if keyword_overlap > 0 or any(word in text_lower for word in question_words):
                scored_chunks.append((keyword_overlap, chunk))
        
        scored_chunks.sort(reverse=True, key=lambda x: x[0])
        top_chunks = [chunk for score, chunk in scored_chunks[:10]]
        
        if not top_chunks:
            return chunks[:5]
        
        return top_chunks
    
    except:
        return chunks[:5]

@app.route('/api/models', methods=['GET'])
def get_models():
    try:
        models = ollama.list()
        model_names = [model['name'] for model in models['models']]
        return jsonify({'models': model_names})
    except Exception as e:
        return jsonify({'error': f'Error fetching models: {str(e)}', 'models': []}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        ollama.list()
        return jsonify({'status': 'ok', 'ollama': 'connected'})
    except:
        return jsonify({'status': 'ok', 'ollama': 'disconnected'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
