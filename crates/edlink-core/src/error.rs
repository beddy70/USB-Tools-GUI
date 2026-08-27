use std::fmt;

/// Erreurs renvoyées par la librairie `edlink-core`.
#[derive(Debug)]
pub enum EdError {
    /// Aucune carte EverDrive trouvée sur les ports série scannés.
    NotFound,
    /// Une opération de la carte a renvoyé un statut d'erreur non nul.
    DeviceError(u8),
    /// La carte détectée n'est pas compatible (mauvais protocol-id ou device-id).
    Unsupported(String),
    /// Erreur d'E/S sur le port série.
    Io(std::io::Error),
    /// Erreur de décodage d'image (screenshot).
    Image(String),
    /// Erreur applicative diverse.
    Other(String),
}

impl fmt::Display for EdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EdError::NotFound => write!(f, "EverDrive not found"),
            EdError::DeviceError(code) => write!(f, "device operation error: 0x{code:02X}"),
            EdError::Unsupported(e) => write!(f, "unsupported device: {e}"),
            EdError::Io(e) => write!(f, "I/O error: {e}"),
            EdError::Image(e) => write!(f, "image error: {e}"),
            EdError::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for EdError {}

impl From<std::io::Error> for EdError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            EdError::NotFound
        } else {
            EdError::Io(e)
        }
    }
}

impl From<serialport::Error> for EdError {
    fn from(e: serialport::Error) -> Self {
        EdError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }
}

impl From<png::EncodingError> for EdError {
    fn from(e: png::EncodingError) -> Self {
        EdError::Image(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, EdError>;
