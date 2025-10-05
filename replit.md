# Document Q&A System

## Overview

A web-based document question-and-answer system that uses local Ollama models to analyze uploaded documents and provide accurate answers with specific references. Users can upload PDF, DOCX, and TXT documents, ask natural language questions, and receive precise answers that cite specific sections, pages, or paragraphs from the source material. The system highlights referenced sections in the document view for easy verification.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes (October 5, 2025)

- Implemented complete document Q&A system with Ollama integration
- Created Flask backend with document upload and text extraction (PDF, DOCX, TXT)
- Built React frontend using legacy JavaScript approach (webpack, no Vite)
- Implemented split-view UI with professional blue color scheme (#2563EB)
- Added text highlighting feature for referenced document sections
- Configured workflows to run both backend (port 8000) and frontend (port 5000)
- Installed Python 3.13 and Node.js 20 with all required dependencies

## Project Architecture

### Frontend Architecture

**Technology Stack**: React 19.2.0 with Webpack 5 bundling (legacy approach, no Vite)

The frontend is a single-page application built with modern React using functional components and hooks. Webpack serves as the build tool and development server, configured to:
- Bundle JavaScript/JSX files using Babel for transpilation
- Process CSS through style-loader and css-loader
- Serve on port 5000 with hot module replacement
- Proxy API requests to the backend on port 8000
- Allow all hosts for Replit compatibility
- Disable caching for proper iframe updates

**Component Structure**: The application uses a single App component that manages all state including document management, chat messages, model selection, file uploads, and highlighted references. The UI features a split-view layout with document panel on the left and chat interface on the right.

**State Management**: Uses React's built-in useState and useEffect hooks for local state management. Key state includes:
- Documents list and active document
- Chat messages with questions, answers, and references
- Highlighted references for visual feedback
- Model selection and loading states

**HTTP Client**: Axios is used for all API communications with the Flask backend via the webpack proxy.

**Highlighting Feature**: When answers are received or messages are clicked, referenced document sections are highlighted in amber (#F59E0B) with a smooth animation effect. This helps users quickly locate the source of information in the document.

### Backend Architecture

**Technology Stack**: Python 3.13 Flask with Flask-CORS for cross-origin support

The backend is a REST API server running on port 8000 that handles:
- Document upload and storage in a local filesystem (`uploads/` directory)
- Text extraction from multiple file formats using pypdf, python-docx
- Document content chunking using LangChain's RecursiveCharacterTextSplitter
- Integration with local Ollama models for LLM-powered question answering
- Relevance scoring to find the most relevant document chunks for questions

**Design Pattern**: RESTful API with clear separation of concerns:
- File upload and validation endpoints
- Document retrieval endpoints
- Question-answering endpoint with Ollama integration
- Model listing and health check endpoints

**File Processing Pipeline**:
1. Validate file type (PDF, DOCX, TXT) and size (max 50MB)
2. Extract text based on file format with metadata (page numbers, sections, line ranges)
3. Chunk text using RecursiveCharacterTextSplitter (1000 chars, 200 overlap)
4. Store processed documents in memory with full metadata
5. For Q&A, score chunks by relevance and provide top matches to LLM

**Q&A Strategy**: The system uses a two-phase approach:
1. Relevance scoring: Each chunk is scored against the question using the LLM
2. Context building: Top-ranked chunks are combined as context for the final answer
3. The LLM generates answers with specific references to source locations

**Security Considerations**: Uses `secure_filename` from Werkzeug to sanitize uploaded filenames and restricts file types and sizes for safety.

### Data Storage

**Document Storage**: Physical files are stored in the `uploads/` directory. Document metadata and extracted text are stored in-memory using a Python dictionary (`documents_store`). This approach:
- Provides fast access during runtime
- Requires no database setup
- Data is lost on server restart (suitable for development)
- Not suitable for production with multiple instances

For production deployment, migrate to a persistent database solution.

### Text Processing

**Libraries Used**:
- `pypdf` (PdfReader) for PDF text extraction with page numbers
- `python-docx` for DOCX file processing with section tracking
- Plain text processing for TXT files with line number tracking
- LangChain's RecursiveCharacterTextSplitter for intelligent text chunking

**Text Chunking Strategy**: Documents are split into 1000-character chunks with 200-character overlap. This allows:
- The LLM to process manageable context sizes
- Overlapping chunks prevent information loss at boundaries
- Better relevance matching for specific questions
- Accurate source attribution with metadata preservation

## External Dependencies

### AI/ML Services

**Ollama Integration**: The application integrates with Ollama, a local LLM runtime. Users must have Ollama installed and running locally with at least one model downloaded (e.g., llama2, mistral, etc.). The system:
- Dynamically fetches available models from Ollama
- Allows model selection in the UI
- Uses the selected model for both relevance scoring and answer generation
- Handles Ollama connection errors gracefully

**Important**: Ollama must be installed and running separately. The application will show errors if Ollama is not available.

### Third-Party Libraries

**Frontend**:
- React & ReactDOM 19.2.0: UI framework
- Axios 1.12.2: HTTP client for API requests
- Babel: JavaScript transpilation for modern syntax support
- Webpack 5.102.0: Module bundler and development server

**Backend**:
- Flask 3.1.2: Web framework
- Flask-CORS 6.0.1: Cross-origin resource sharing support
- pypdf 6.1.1: PDF text extraction
- python-docx 1.2.0: Microsoft Word document processing
- LangChain 0.3.27 & LangChain-Community 0.3.30: Text splitting and processing
- Ollama 0.6.0: Local LLM integration

### Development Tools

**Webpack Dev Server**: Configured with:
- Hot module replacement for instant updates
- Proxy configuration routing `/api/*` to backend on port 8000
- Permissive CORS and host settings for Replit environment
- Cache control headers to prevent iframe caching issues

**Build Process**: 
- Development: `npm start` launches webpack dev server on port 5000
- Production: `npm run build` creates optimized bundles in `dist/` directory
- Backend: `python backend/app.py` runs Flask server on port 8000
- Unified: `bash start.sh` runs both servers simultaneously

## Color Palette

The UI follows a professional, document-focused design with these colors:
- **Primary**: #2563EB (professional blue) - header, buttons, borders
- **Secondary**: #64748B (slate grey) - labels, metadata
- **Background**: #F8FAFC (light grey) - main background
- **Text**: #1E293B (dark slate) - primary text
- **Accent**: #10B981 (success green) - answer highlights
- **Warning**: #F59E0B (amber) - reference highlights

## Usage Instructions

1. **Start the application**: The workflow automatically starts both backend and frontend servers
2. **Upload a document**: Click "Choose File" and select a PDF, DOCX, or TXT file (max 50MB)
3. **Select Ollama model**: Choose from available local models in the dropdown
4. **Ask questions**: Type natural language questions about the document content
5. **View answers**: Answers appear with referenced sections highlighted in amber
6. **Click messages**: Click any answered message to re-highlight its referenced sections
7. **Multiple documents**: Upload and switch between multiple documents

## Known Limitations

- Ollama must be installed and running locally with models downloaded
- Document data is stored in memory and lost on server restart
- No user authentication or multi-user support
- Not suitable for production without database migration
- Large documents may take time to process and score

## Future Enhancements

Potential improvements for future development:
- Persistent database storage for documents and conversations
- User authentication and session management
- OCR support for scanned PDFs
- Table extraction and structured data handling
- Document comparison and multi-source analysis
- Export functionality for Q&A sessions
- Conversation history persistence
- Advanced search and filtering for document collections
