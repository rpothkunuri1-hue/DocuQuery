import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = '/api';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
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
  const [ollamaConnected, setOllamaConnected] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [conversationContext, setConversationContext] = useState([]);
  const [multiDocMode, setMultiDocMode] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  
  const documentContentRef = useRef(null);
  const chatMessagesRef = useRef(null);

  useEffect(() => {
    fetchModels();
    fetchDocuments();
    const interval = setInterval(checkOllamaConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [darkMode]);

  const checkOllamaConnection = async () => {
    try {
      await axios.get(`${API_BASE_URL}/health`);
      setOllamaConnected(true);
    } catch (error) {
      setOllamaConnected(false);
    }
  };

  const fetchModels = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/models`);
      if (response.data.models && response.data.models.length > 0) {
        setModels(response.data.models);
        setSelectedModel(response.data.models[0]);
        setOllamaConnected(true);
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      setOllamaConnected(false);
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
    setUploadProgress(0);
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
    setUploadProgress(0);

    try {
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      setStatus({ type: 'success', message: `Document uploaded successfully! (${response.data.chunks_count} chunks processed)` });
      setSelectedFile(null);
      setUploadProgress(0);
      document.getElementById('file-input').value = '';
      fetchDocuments();
      
      setActiveDoc(response.data.doc_id);
      await fetchDocumentContent(response.data.doc_id);
      
      if (response.data.summary) {
        setStatus({ type: 'info', message: `Summary: ${response.data.summary}` });
      }
    } catch (error) {
      setStatus({ 
        type: 'error', 
        message: error.response?.data?.error || 'Error uploading file' 
      });
      setUploadProgress(0);
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
    setConversationContext([]);
  };

  const scrollToHighlightedSection = useCallback(() => {
    if (highlightedRefs.length > 0 && documentContentRef.current) {
      const firstRef = highlightedRefs[0];
      const fileType = documentContent?.file_type || '';
      const sectionId = `section-${fileType}-${firstRef.page || firstRef.section || firstRef.lines}`;
      const element = document.getElementById(sectionId);
      
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedRefs, documentContent]);

  useEffect(() => {
    scrollToHighlightedSection();
  }, [highlightedRefs, scrollToHighlightedSection]);

  const handleAskQuestion = async (e) => {
    e.preventDefault();

    if (!question.trim()) {
      setStatus({ type: 'error', message: 'Please enter a question' });
      return;
    }

    if (!multiDocMode && !activeDoc) {
      setStatus({ type: 'error', message: 'Please select a document first' });
      return;
    }

    if (!ollamaConnected) {
      setStatus({ type: 'error', message: 'Ollama is not connected. Please check the connection.' });
      return;
    }

    setLoading(true);
    setStatus(null);
    setStreamingAnswer('');

    const newMessage = {
      question: question,
      answer: null,
      references: [],
      streaming: true,
    };

    setMessages([...messages, newMessage]);
    const currentQuestion = question;
    setQuestion('');

    const context = conversationContext.map(msg => ({
      question: msg.question,
      answer: msg.answer
    }));

    try {
      const endpoint = multiDocMode ? `${API_BASE_URL}/ask-multi` : `${API_BASE_URL}/ask-stream`;
      const payload = multiDocMode 
        ? { question: currentQuestion, model: selectedModel, context }
        : { question: currentQuestion, doc_id: activeDoc, model: selectedModel, context };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';
      let references = [];
      let confidence = 'medium';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              
              if (data.token) {
                fullAnswer += data.token;
                setStreamingAnswer(fullAnswer);
              }
              
              if (data.references) {
                references = data.references;
              }
              
              if (data.confidence) {
                confidence = data.confidence;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      const updatedMessage = {
        question: currentQuestion,
        answer: fullAnswer,
        references: references,
        confidence: confidence,
        streaming: false,
      };

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = updatedMessage;
        return newMessages;
      });
      
      setConversationContext(prev => [...prev, updatedMessage]);
      setHighlightedRefs(references.map(ref => ref.metadata));
      setStreamingAnswer('');
    } catch (error) {
      const errorMessage = error.message || 'Error processing question';
      setStatus({ type: 'error', message: errorMessage });
      setMessages(prev => prev.filter(m => m.answer !== null));
      setStreamingAnswer('');
    } finally {
      setLoading(false);
    }
  };

  const handleMessageClick = (references) => {
    if (references && references.length > 0) {
      setHighlightedRefs(references.map(ref => ref.metadata));
    }
  };

  const handleReferenceClick = (ref) => {
    setHighlightedRefs([ref.metadata]);
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

  const handleSearch = (query) => {
    setSearchQuery(query.toLowerCase());
  };

  const filteredDocumentContent = () => {
    if (!documentContent || !searchQuery) return documentContent;
    
    const filtered = {
      ...documentContent,
      text_data: documentContent.text_data.filter(section =>
        section.text.toLowerCase().includes(searchQuery)
      ),
    };
    return filtered;
  };

  const exportConversation = () => {
    const text = messages.map(msg => {
      let content = `Q: ${msg.question}\n`;
      if (msg.answer) {
        content += `A: ${msg.answer}\n`;
        if (msg.references && msg.references.length > 0) {
          content += `\nReferences:\n`;
          msg.references.forEach(ref => {
            content += `- ${ref.metadata.page ? `Page ${ref.metadata.page}` : ref.metadata.section ? `Section ${ref.metadata.section}` : `Lines ${ref.metadata.lines}`}: ${ref.text}\n`;
          });
        }
        content += `\n${'='.repeat(80)}\n\n`;
      }
      return content;
    }).join('');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderDocumentContent = () => {
    const content = filteredDocumentContent();
    
    if (!content) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-text">No Document Selected</div>
          <div className="empty-state-subtext">Upload and select a document to view its content</div>
        </div>
      );
    }

    const { filename, file_type, text_data } = content;

    if (text_data.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">No Results Found</div>
          <div className="empty-state-subtext">Try a different search term</div>
        </div>
      );
    }

    return (
      <div className="document-content" ref={documentContentRef}>
        <div className="document-header">
          <h3>{filename}</h3>
          <input
            type="text"
            className="document-search"
            placeholder="Search in document..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
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
        <div className="header-content">
          <div>
            <h1>Document Q&A System</h1>
            <p>Upload documents and ask questions using local Ollama models</p>
          </div>
          <div className="header-actions">
            <button 
              className="icon-btn" 
              onClick={() => setDarkMode(!darkMode)}
              title="Toggle dark mode"
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            {messages.length > 0 && (
              <button 
                className="icon-btn" 
                onClick={exportConversation}
                title="Export conversation"
              >
                📥
              </button>
            )}
          </div>
        </div>
      </header>

      {!ollamaConnected && (
        <div className="ollama-banner">
          <div className="ollama-banner-content">
            <span className="ollama-icon">⚠️</span>
            <div className="ollama-message">
              <strong>Ollama not detected</strong>
              <p>Please ensure Ollama is running locally. <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">Learn how to install Ollama</a></p>
            </div>
            <button className="retry-btn" onClick={checkOllamaConnection}>
              Retry Connection
            </button>
          </div>
        </div>
      )}

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
                {loading && uploadProgress > 0 ? `${uploadProgress}%` : 'Upload'}
              </button>
            </div>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
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

          {documents.length > 1 && (
            <div className="multi-doc-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={multiDocMode}
                  onChange={(e) => setMultiDocMode(e.target.checked)}
                />
                <span>Search across all documents</span>
              </label>
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
          <div className="chat-messages" ref={chatMessagesRef}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <div className="empty-state-text">No Questions Yet</div>
                <div className="empty-state-subtext">
                  Ask a question about your document{documents.length > 1 && ' or all documents'} below
                  <br />
                  <small>Tip: Press Ctrl+Enter to send</small>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className="message"
                  onClick={() => !msg.streaming && handleMessageClick(msg.references)}
                >
                  <div className="message-question">
                    <div className="message-label">Question</div>
                    <div className="message-text">{msg.question}</div>
                  </div>
                  {(msg.answer || msg.streaming) && (
                    <>
                      <div className="message-answer">
                        <div className="message-label-row">
                          <div className="message-label">Answer</div>
                          {msg.confidence && !msg.streaming && (
                            <div className={`confidence-badge confidence-${msg.confidence}`}>
                              {msg.confidence === 'high' ? '✓ High confidence' : 
                               msg.confidence === 'medium' ? '~ Medium confidence' : 
                               '! Low confidence'}
                            </div>
                          )}
                        </div>
                        <div className="message-text">
                          {msg.streaming ? streamingAnswer : msg.answer}
                          {msg.streaming && <span className="cursor-blink">▋</span>}
                        </div>
                      </div>
                      {msg.references && msg.references.length > 0 && !msg.streaming && (
                        <div className="message-references">
                          <div className="references-title">Referenced Sections</div>
                          {msg.references.map((ref, refIdx) => (
                            <div 
                              key={refIdx} 
                              className="reference-item clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReferenceClick(ref);
                              }}
                            >
                              <div className="reference-metadata">
                                📍 {ref.metadata.page && `Page ${ref.metadata.page}`}
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
                  {msg.streaming && !msg.answer && (
                    <div className="loading">
                      <div className="spinner"></div>
                      <span>Thinking...</span>
                    </div>
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
                placeholder={multiDocMode ? "Ask a question across all documents..." : "Ask a question about your document..."}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAskQuestion(e);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAskQuestion(e);
                  }
                }}
                rows="2"
                disabled={loading || (!multiDocMode && !activeDoc)}
              />
              <button 
                type="submit" 
                className="send-btn"
                disabled={loading || (!multiDocMode && !activeDoc) || !question.trim()}
              >
                {loading ? (
                  <>
                    <div className="spinner-small"></div>
                    <span>Sending...</span>
                  </>
                ) : (
                  'Send'
                )}
              </button>
            </form>
            {conversationContext.length > 0 && (
              <div className="context-indicator">
                💬 {conversationContext.length} message{conversationContext.length > 1 ? 's' : ''} in context
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
