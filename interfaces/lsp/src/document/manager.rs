use std::collections::HashMap;

use tower_lsp::lsp_types::Url;

#[derive(Debug, Default, Clone)]
pub struct DocumentManager {
    documents: HashMap<Url, TextDocument>,
}

impl DocumentManager {
    pub fn open(&mut self, document: TextDocument) {
        self.documents.insert(document.uri.clone(), document);
    }

    pub fn update(&mut self, uri: &Url, content: String, version: i32) {
        if let Some(document) = self.documents.get_mut(uri) {
            document.content = content;
            document.version = version;
        }
    }

    pub fn get(&self, uri: &Url) -> Option<&TextDocument> {
        self.documents.get(uri)
    }

    pub fn close(&mut self, uri: &Url) {
        self.documents.remove(uri);
    }
}

#[derive(Debug, Clone)]
pub struct TextDocument {
    pub uri: Url,
    pub content: String,
    pub version: i32,
    pub language_id: String,
}
