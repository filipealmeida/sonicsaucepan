use thiserror::Error;

pub type Result<T> = std::result::Result<T, SsError>;

#[derive(Debug, Error)]
pub enum SsError {
    #[error("node {0} was not found")]
    NodeNotFound(u64),

    #[error("the initial node cannot be removed")]
    CannotRemoveInitialNode,

    #[error("invalid roman numeral: {0}")]
    InvalidRomanNumeral(String),

    #[error("invalid pitch class: {0}")]
    InvalidPitchClass(String),

    #[error("invalid chord definition: {0}")]
    InvalidChordDefinition(String),

    #[error("midi note out of range (0..=127): {0}")]
    MidiOutOfRange(i16),

    #[error("invalid transport settings: {0}")]
    InvalidTransport(String),
}
