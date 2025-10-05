from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
import json

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

class Document(db.Model):
    __tablename__ = 'documents'
    
    id = db.Column(db.Integer, primary_key=True)
    doc_id = db.Column(db.String(255), unique=True, nullable=False, index=True)
    filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(10), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    chunks = db.Column(db.Text, nullable=False)
    raw_text_data = db.Column(db.Text, nullable=False)
    summary = db.Column(db.Text)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    conversations = db.relationship('Conversation', backref='document', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'doc_id': self.doc_id,
            'filename': self.filename,
            'file_type': self.file_type,
            'chunks_count': len(json.loads(self.chunks)),
            'summary': self.summary,
            'uploaded_at': self.uploaded_at.isoformat()
        }
    
    def get_chunks(self):
        return json.loads(self.chunks)
    
    def set_chunks(self, chunks_list):
        self.chunks = json.dumps(chunks_list)
    
    def get_raw_text_data(self):
        return json.loads(self.raw_text_data)
    
    def set_raw_text_data(self, text_data_list):
        self.raw_text_data = json.dumps(text_data_list)

class Conversation(db.Model):
    __tablename__ = 'conversations'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('documents.id'), nullable=False, index=True)
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text, nullable=False)
    references = db.Column(db.Text)
    confidence = db.Column(db.String(20))
    model_used = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'question': self.question,
            'answer': self.answer,
            'references': json.loads(self.references) if self.references else [],
            'confidence': self.confidence,
            'model_used': self.model_used,
            'created_at': self.created_at.isoformat()
        }
    
    def set_references(self, references_list):
        self.references = json.dumps(references_list)
