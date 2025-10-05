import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import ollama
from pypdf import PdfReader
from docx import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt'}
MAX_FILE_SIZE = 50 * 1024 * 1024

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

documents_store = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
        
        for para in doc.paragraphs:
            if para.text.strip():
                current_text.append(para.text.strip())
                if len(current_text) >= 10:
                    text_data.append({
                        'section': current_section,
                        'text': '\n'.join(current_text)
                    })
                    current_section += 1
                    current_text = []
        
        if current_text:
            text_data.append({
                'section': current_section,
                'text': '\n'.join(current_text)
            })
        
        return text_data
    except Exception as e:
        raise Exception(f"Error extracting DOCX: {str(e)}")

def extract_text_from_txt(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
        
        lines = text.split('\n')
        text_data = []
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

def chunk_text(text_data, file_type):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
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
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        file_ext = filename.rsplit('.', 1)[1].lower()
        
        if file_ext == 'pdf':
            text_data = extract_text_from_pdf(file_path)
        elif file_ext == 'docx':
            text_data = extract_text_from_docx(file_path)
        else:
            text_data = extract_text_from_txt(file_path)
        
        chunks = chunk_text(text_data, file_ext)
        
        doc_id = filename
        documents_store[doc_id] = {
            'filename': filename,
            'file_type': file_ext,
            'chunks': chunks,
            'raw_text_data': text_data
        }
        
        return jsonify({
            'success': True,
            'doc_id': doc_id,
            'filename': filename,
            'chunks_count': len(chunks)
        })
    
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

@app.route('/api/ask', methods=['POST'])
def ask_question():
    data = request.json
    question = data.get('question', '')
    doc_id = data.get('doc_id', '')
    model = data.get('model', 'llama2')
    
    if not question:
        return jsonify({'error': 'Question is required'}), 400
    
    if not doc_id or doc_id not in documents_store:
        return jsonify({'error': 'Valid document ID is required'}), 400
    
    try:
        doc = documents_store[doc_id]
        chunks = doc['chunks']
        
        relevant_chunks = find_relevant_chunks(question, chunks, model)
        
        if not relevant_chunks:
            return jsonify({
                'answer': "I couldn't find relevant information in the document to answer this question.",
                'references': [],
                'confidence': 'low'
            })
        
        context = "\n\n".join([chunk['text'] for chunk in relevant_chunks[:3]])
        
        prompt = f"""Based on the following document excerpts, answer the question. If the answer isn't in the excerpts, say so clearly.

Document excerpts:
{context}

Question: {question}

Answer with specific references to the document (mention page numbers, sections, or line numbers where applicable). If the information is not in the provided excerpts, clearly state that."""

        response = ollama.chat(model=model, messages=[
            {
                'role': 'user',
                'content': prompt
            }
        ])
        
        answer = response['message']['content']
        
        references = []
        for chunk in relevant_chunks[:3]:
            ref = {
                'text': chunk['text'][:200] + '...' if len(chunk['text']) > 200 else chunk['text'],
                'metadata': chunk['metadata']
            }
            references.append(ref)
        
        return jsonify({
            'answer': answer,
            'references': references,
            'confidence': 'high' if len(relevant_chunks) >= 2 else 'medium'
        })
    
    except Exception as e:
        error_msg = str(e)
        if 'model' in error_msg.lower() or 'not found' in error_msg.lower():
            return jsonify({
                'error': f'Ollama model error: {error_msg}. Make sure Ollama is running and the model "{model}" is installed.'
            }), 500
        return jsonify({'error': f'Error processing question: {error_msg}'}), 500

def find_relevant_chunks(question, chunks, model):
    try:
        scored_chunks = []
        
        for chunk in chunks:
            prompt = f"""Question: {question}

Text: {chunk['text']}

On a scale of 0-10, how relevant is this text to answering the question? Reply with only a number."""
            
            response = ollama.chat(model=model, messages=[
                {'role': 'user', 'content': prompt}
            ])
            
            score_text = response['message']['content'].strip()
            try:
                score = float(score_text.split()[0])
            except:
                score = 0
            
            if score >= 5:
                scored_chunks.append((score, chunk))
        
        scored_chunks.sort(reverse=True, key=lambda x: x[0])
        return [chunk for score, chunk in scored_chunks[:5]]
    
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
