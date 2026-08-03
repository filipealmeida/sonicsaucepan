use serde::{Deserialize, Serialize};

use crate::error::{Result, SsError};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct TransportSettings {
    pub bpm: f32,
    pub numerator: u8,
    pub denominator: u8,
    pub swing: f32,
}

impl Default for TransportSettings {
    fn default() -> Self {
        Self {
            bpm: 120.0,
            numerator: 4,
            denominator: 4,
            swing: 0.0,
        }
    }
}

impl TransportSettings {
    pub fn validate(self) -> Result<Self> {
        if !(20.0..=300.0).contains(&self.bpm) {
            return Err(SsError::InvalidTransport(
                "bpm must be in 20.0..=300.0".to_string(),
            ));
        }
        if self.numerator == 0 {
            return Err(SsError::InvalidTransport(
                "time signature numerator must be > 0".to_string(),
            ));
        }
        if !matches!(self.denominator, 1 | 2 | 4 | 8 | 16 | 32) {
            return Err(SsError::InvalidTransport(
                "time signature denominator must be one of 1,2,4,8,16,32".to_string(),
            ));
        }
        if !(-0.5..=0.5).contains(&self.swing) {
            return Err(SsError::InvalidTransport(
                "swing must be in -0.5..=0.5".to_string(),
            ));
        }

        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_valid() {
        assert!(TransportSettings::default().validate().is_ok());
    }

    #[test]
    fn invalid_bpm_is_rejected() {
        let invalid = TransportSettings {
            bpm: 400.0,
            ..TransportSettings::default()
        };
        assert!(invalid.validate().is_err());
    }
}
