//! Canonical CBOR subset matching the TypeScript harness encoder
//! (`packages/agents/src/dependencies/cbor.ts`) and `@knolo/core`.

use crate::CoreError;
use serde_json::Value;

pub fn canonical_cbor(value: &Value) -> Result<Vec<u8>, CoreError> {
    let mut out = Vec::new();
    encode(value, &mut out)?;
    Ok(out)
}

fn encode(value: &Value, out: &mut Vec<u8>) -> Result<(), CoreError> {
    match value {
        Value::Null => {
            out.push(0xf6);
            Ok(())
        }
        Value::Bool(true) => {
            out.push(0xf5);
            Ok(())
        }
        Value::Bool(false) => {
            out.push(0xf4);
            Ok(())
        }
        Value::String(text) => {
            encode_length(3, text.len(), out)?;
            out.extend_from_slice(text.as_bytes());
            Ok(())
        }
        Value::Number(number) => {
            let Some(integer) = number.as_i64() else {
                return Err(CoreError::SchemaViolation(
                    "canonical CBOR numbers must be safe integers".into(),
                ));
            };
            if integer >= 0 {
                encode_length(0, integer as usize, out)
            } else {
                encode_length(1, (-1 - integer) as usize, out)
            }
        }
        Value::Array(items) => {
            encode_length(4, items.len(), out)?;
            for item in items {
                encode(item, out)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|(left, _), (right, _)| compare_utf8(left, right));
            encode_length(5, entries.len(), out)?;
            for (key, item) in entries {
                encode(&Value::String((*key).clone()), out)?;
                encode(item, out)?;
            }
            Ok(())
        }
    }
}

fn encode_length(major: u8, length: usize, out: &mut Vec<u8>) -> Result<(), CoreError> {
    let prefix = major << 5;
    if length < 24 {
        out.push(prefix | length as u8);
    } else if length <= 0xff {
        out.push(prefix | 24);
        out.push(length as u8);
    } else if length <= 0xffff {
        out.push(prefix | 25);
        out.push((length >> 8) as u8);
        out.push((length & 0xff) as u8);
    } else if length <= 0xffff_ffff {
        out.push(prefix | 26);
        out.push((length >> 24) as u8);
        out.push((length >> 16) as u8);
        out.push((length >> 8) as u8);
        out.push((length & 0xff) as u8);
    } else {
        return Err(CoreError::SchemaViolation(
            "canonical CBOR length exceeds 32-bit encoding".into(),
        ));
    }
    Ok(())
}

fn compare_utf8(left: &str, right: &str) -> std::cmp::Ordering {
    left.as_bytes().cmp(right.as_bytes())
}
