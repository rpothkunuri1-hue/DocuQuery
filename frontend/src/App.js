import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = '/api';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [documentContent, setDocumentContent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('llama2');
  const [highlightedRefs, setHighlightedRefs] = useState([]);

  useEffect(() => {
    fetchModels();
    fetchDocuments();
  }, []);

  const fetchModels = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/models`);
      if (response.data.models && response.data.models.length > 0) {
        setModels(response.data.models);
        setSelectedModel(response.data.models[0]);
      }
    } catch (error) {
      console.error('Error fetching models:', error);
    }
  };

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/documents`);
      setDocuments(response.data.documents);
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setStatus({ type: 'error', message: 'Please select a file first' });
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    setLoading(true);
    setStatus(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setStatus({ type: 'success', message: `Document uploaded successfully! (${response.data.chunks_count} chunks processed)` });
      setSelectedFile(null);
      document.getElementById('file-input').value = '';
      fetchDocuments();
      
      setActiveDoc(response.data.doc_id);
      fetchDocumentContent(response.data.doc_id);
    } catch (error) {
      setStatus({ 
        type: 'error', 
        message: error.response?.data?.error || 'Error uploading file' 
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchDocumentContent = async (docId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/document/${docId}`);
      setDocumentContent(response.data);
    } catch (error) {
      console.error('Error fetching document content:', error);
    }
  };

  const handleDocumentSelect = (docId) => {
    setActiveDoc(docId);
    fetchDocumentContent(docId);
    setMessages([]);
    setHighlightedRefs([]);
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();

    if (!question.trim()) {
      setStatus({ type: 'error', message: 'Please enter a question' });
      return;
    }

    if (!activeDoc) {
      setStatus({ type: 'error', message: 'Please select a document first' });
      return;
    }

    setLoading(true);
    setStatus(null);

    const newMessage = {
      question: question,
      answer: null,
      references: [],
    };

    setMessages([...messages, newMessage]);
    setQuestion('');

    try {
      const response = await axios.post(`${API_BASE_URL}/ask`, {
        question: question,
        doc_id: activeDoc,
        model: selectedModel,
      });

      const updatedMessage = {
        question: question,
        answer: response.data.answer,
        references: response.data.references,
        confidence: response.data.confidence,
      };

      setMessages([...messages, updatedMessage]);
      setHighlightedRefs(response.data.references.map(ref => ref.metadata));
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Error processing question';
      setStatus({ type: 'error', message: errorMessage });
      
      setMessages(messages.filter(m => m.answer !== null));
    } finally {
      setLoading(false);
    }
  };

  const handleMessageClick = (references) => {
    if (references && references.length > 0) {
      setHighlightedRefs(references.map(ref => ref.metadata));
    }
  };

  const isHighlighted = (section) => {
    return highlightedRefs.some(ref => {
      if (ref.page && section.page) {
        return ref.page === section.page;
      }
      if (ref.section && section.section) {
        return ref.section === section.section;
      }
      if (ref.lines && section.lines) {
        return ref.lines === section.lines;
      }
      return false;
    });
  };

  const renderDocumentContent = () => {
    if (!documentContent) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-text">No Document Selected</div>
          <div className="empty-state-subtext">Upload and select a document to view its content</div>
        </div>
      );
    }

    const { filename, file_type, text_data } = documentContent;

    return (
      <div className="document-content">
        <h3>{filename}</h3>
        {text_data.map((section, idx) => {
          const highlighted = isHighlighted(section);
          return (
            <div 
              key={idx} 
              className={`document-section ${highlighted ? 'highlighted' : ''}`}
              id={`section-${file_type}-${section.page || section.section || section.lines}`}
            >
              <div className="section-label">
                {file_type === 'pdf' && `Page ${section.page}`}
                {file_type === 'docx' && `Section ${section.section}`}
                {file_type === 'txt' && `Lines ${section.lines}`}
              </div>
              <div className="section-text">{section.text}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Document Q&A System</h1>
        <p>Upload documents and ask questions using local Ollama models</p>
      </header>

      <div className="main-container">
        <div className="document-panel">
          <div className="upload-section">
            <div className="upload-container">
              <div className="file-input-wrapper">
                <label htmlFor="file-input" className="file-input-label">
                  Choose File
                </label>
                <input
                  id="file-input"
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={handleFileChange}
                />
              </div>
              <span className="selected-file">
                {selectedFile ? selectedFile.name : 'No file selected'}
              </span>
              <button 
                className="upload-btn" 
                onClick={handleUpload}
                disabled={!selectedFile || loading}
              >
                Upload
              </button>
            </div>
          </div>

          {models.length > 0 && (
            <div className="model-selector">
              <label htmlFor="model-select">Ollama Model:</label>
              <select 
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
          )}

          {documents.length > 0 && (
            <div className="document-list">
              <h3>Uploaded Documents</h3>
              {documents.map(doc => (
                <div
                  key={doc.doc_id}
                  className={`document-item ${activeDoc === doc.doc_id ? 'active' : ''}`}
                  onClick={() => handleDocumentSelect(doc.doc_id)}
                >
                  <div className="document-item-name">{doc.filename}</div>
                  <div className="document-item-meta">
                    {doc.file_type.toUpperCase()} • {doc.chunks_count} chunks
                  </div>
                </div>
              ))}
            </div>
          )}

          {renderDocumentContent()}
        </div>

        <div className="chat-panel">
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <div className="empty-state-text">No Questions Yet</div>
                <div className="empty-state-subtext">Ask a question about your document below</div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className="message"
                  onClick={() => handleMessageClick(msg.references)}
                >
                  <div className="message-question">
                    <div className="message-label">Question</div>
                    <div className="message-text">{msg.question}</div>
                  </div>
                  {msg.answer && (
                    <>
                      <div className="message-answer">
                        <div className="message-label">Answer</div>
                        <div className="message-text">{msg.answer}</div>
                      </div>
                      {msg.references && msg.references.length > 0 && (
                        <div className="message-references">
                          <div className="references-title">Referenced Sections (Click to highlight)</div>
                          {msg.references.map((ref, refIdx) => (
                            <div key={refIdx} className="reference-item">
                              <div className="reference-metadata">
                                {ref.metadata.page && `Page ${ref.metadata.page}`}
                                {ref.metadata.section && `Section ${ref.metadata.section}`}
                                {ref.metadata.lines && `Lines ${ref.metadata.lines}`}
                              </div>
                              <div className="reference-text">{ref.text}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {!msg.answer && (
                    <div className="loading">Processing your question...</div>
                  )}
                </div>
              ))
            )}
            {status && (
              <div className={`status-message status-${status.type}`}>
                {status.message}
              </div>
            )}
          </div>

          <div className="chat-input-container">
            <form onSubmit={handleAskQuestion} className="chat-input-form">
              <textarea
                className="chat-input"
                placeholder="Ask a question about your document..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAskQuestion(e);
                  }
                }}
                rows="2"
                disabled={loading || !activeDoc}
              />
              <button 
                type="submit" 
                className="send-btn"
                disabled={loading || !activeDoc || !question.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
