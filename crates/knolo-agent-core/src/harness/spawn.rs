//! Inert spawn envelopes. Validation and digest only. No model and no worker.

use super::receipt::{EvaluationReceiptV1, InvocationStatusV1};
use super::task::TaskV1;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const LEVELS: &[&str] = &["L0", "L1", "L2", "L3", "platform"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnParentV1 {
    pub version: u16,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub level: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnAuthorityV1 {
    pub capabilities: Vec<String>,
    pub tools: Vec<String>,
    pub namespaces: Vec<String>,
    pub max_steps: u64,
    pub max_cost_micros: u64,
}

impl SpawnAuthorityV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.max_steps == 0 || self.max_cost_micros == 0 {
            return Err(CoreError::SchemaViolation(
                "spawn authority budgets must be positive integers".into(),
            ));
        }
        for (label, values) in [
            ("capabilities", &self.capabilities),
            ("tools", &self.tools),
            ("namespaces", &self.namespaces),
        ] {
            if values.iter().any(|item| item.is_empty()) {
                return Err(CoreError::SchemaViolation(format!(
                    "spawn authority {label} must be non-empty strings"
                )));
            }
        }
        Ok(())
    }

    pub fn narrowed_by(&self, parent: &Self, pack: &Self) -> Result<(), CoreError> {
        self.validate()?;
        parent.validate()?;
        pack.validate()?;
        let subset = |child: &[String], ceiling: &[String]| {
            child
                .iter()
                .all(|item| ceiling.iter().any(|allowed| allowed == item))
        };
        if !subset(&self.capabilities, &parent.capabilities)
            || !subset(&self.capabilities, &pack.capabilities)
            || !subset(&self.tools, &parent.tools)
            || !subset(&self.tools, &pack.tools)
            || !subset(&self.namespaces, &parent.namespaces)
            || !subset(&self.namespaces, &pack.namespaces)
            || self.max_steps > parent.max_steps.min(pack.max_steps)
            || self.max_cost_micros > parent.max_cost_micros.min(pack.max_cost_micros)
        {
            return Err(CoreError::AuthorityEscalation(
                "spawn authority exceeds parent execution or pack policy".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnEnvelopeV1 {
    pub version: u16,
    pub parent: SpawnParentV1,
    pub task: TaskV1,
    pub task_root: String,
    pub authority: SpawnAuthorityV1,
    pub context_root: String,
    pub dependency_root: String,
    pub skill_selection_receipt: Option<String>,
    pub evidence_receipts: Vec<String>,
    pub knowledge_state_roots: Vec<String>,
    pub return_contract: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry_ms: Option<u64>,
    pub envelope_root: String,
}

impl SpawnEnvelopeV1 {
    pub fn parse(value: &str) -> Result<Self, CoreError> {
        let envelope: Self = serde_json::from_str(value)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        envelope.validate_shape()?;
        envelope.verify_root(value)?;
        Ok(envelope)
    }

    pub fn validate(
        &self,
        parent: &SpawnAuthorityV1,
        pack: &SpawnAuthorityV1,
    ) -> Result<(), CoreError> {
        self.validate_shape()?;
        self.authority.narrowed_by(parent, pack)
    }

    fn validate_shape(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::SchemaViolation(
                "spawn envelope version must be 1".into(),
            ));
        }
        if self.parent.version != 1
            || self.parent.id.trim().is_empty()
            || self.parent.id.len() > 128
        {
            return Err(CoreError::SchemaViolation(
                "spawn parent descriptor is invalid".into(),
            ));
        }
        if !LEVELS.contains(&self.parent.level.as_str()) {
            return Err(CoreError::SchemaViolation(
                "spawn parent level is not a known assurance level".into(),
            ));
        }
        self.task.validate()?;
        self.authority.validate()?;
        if !self.task_root.starts_with("task:") {
            return Err(CoreError::SchemaViolation(
                "spawn taskRoot is required".into(),
            ));
        }
        if !self.context_root.starts_with("context:") {
            return Err(CoreError::SchemaViolation(
                "spawn contextRoot is required".into(),
            ));
        }
        if self.dependency_root.is_empty() {
            return Err(CoreError::SchemaViolation(
                "spawn dependencyRoot is required".into(),
            ));
        }
        if self.return_contract.trim().is_empty() {
            return Err(CoreError::SchemaViolation(
                "spawn returnContract must be a non-empty string".into(),
            ));
        }
        if matches!(self.expiry_ms, Some(0)) {
            return Err(CoreError::SchemaViolation(
                "spawn expiryMs must be a positive integer".into(),
            ));
        }
        if !self.envelope_root.starts_with("spawn:") {
            return Err(CoreError::SchemaViolation(
                "spawn envelopeRoot is required".into(),
            ));
        }
        Ok(())
    }

    fn verify_root(&self, raw: &str) -> Result<(), CoreError> {
        let mut body: BTreeMap<String, Box<RawValue>> = serde_json::from_str(raw)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        if body.remove("envelopeRoot").is_none() {
            return Err(CoreError::SchemaViolation(
                "spawn envelope must be an object".into(),
            ));
        }
        let canonical = canonical_object(&body)?;
        let computed = digest_text("spawn", &canonical);
        if computed != self.envelope_root {
            return Err(CoreError::SchemaViolation(
                "spawn envelope root mismatch".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnReceiptV1 {
    pub version: u16,
    pub envelope_root: String,
    pub output_root: String,
    pub evaluation: EvaluationReceiptV1,
    pub skill_selection_receipt: Option<String>,
    pub evidence_receipts: Vec<String>,
    pub knowledge_state_roots: Vec<String>,
    pub final_status: InvocationStatusV1,
    pub output: Value,
}

impl SpawnReceiptV1 {
    pub fn parse(value: &str) -> Result<Self, CoreError> {
        let receipt: Self = serde_json::from_str(value)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        if receipt.version != 1 || !receipt.envelope_root.starts_with("spawn:") {
            return Err(CoreError::SchemaViolation(
                "SpawnReceiptV1.version must be 1".into(),
            ));
        }
        let raw: BTreeMap<String, Box<RawValue>> = serde_json::from_str(value)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        let output = raw
            .get("output")
            .ok_or_else(|| CoreError::SchemaViolation("spawn output is required".into()))?;
        let output_root = digest_text("output", &canonical_raw(output.get())?);
        if output_root != receipt.output_root {
            return Err(CoreError::SchemaViolation(
                "spawn output root mismatch".into(),
            ));
        }
        Ok(receipt)
    }
}

fn digest_text(label: &str, canonical: &str) -> String {
    let digest = Sha256::digest(canonical.as_bytes());
    format!("{label}:{}", hex_encode(&digest))
}

/// Canonical JSON with sorted object keys. Numbers are parsed with Rust's
/// decimal conversion and written with ECMAScript `JSON.stringify` rules.
/// serde_json's own float parser and formatter disagree with that text.
fn canonical_raw(text: &str) -> Result<String, CoreError> {
    let mut out = String::new();
    write_raw(&mut out, text)?;
    Ok(out)
}

fn canonical_object(map: &BTreeMap<String, Box<RawValue>>) -> Result<String, CoreError> {
    let mut out = String::new();
    write_object(&mut out, map)?;
    Ok(out)
}

fn write_raw(out: &mut String, text: &str) -> Result<(), CoreError> {
    let text = text.trim();
    match text.as_bytes().first() {
        Some(b'{') => {
            let map: BTreeMap<String, Box<RawValue>> = serde_json::from_str(text)
                .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
            write_object(out, &map)
        }
        Some(b'[') => {
            let items: Vec<Box<RawValue>> = serde_json::from_str(text)
                .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_raw(out, item.get())?;
            }
            out.push(']');
            Ok(())
        }
        Some(b'"') => {
            let value: String = serde_json::from_str(text)
                .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
            push_json_string(out, &value);
            Ok(())
        }
        Some(b't') => {
            if text != "true" {
                return Err(CoreError::SchemaViolation("invalid JSON literal".into()));
            }
            out.push_str("true");
            Ok(())
        }
        Some(b'f') => {
            if text != "false" {
                return Err(CoreError::SchemaViolation("invalid JSON literal".into()));
            }
            out.push_str("false");
            Ok(())
        }
        Some(b'n') => {
            if text != "null" {
                return Err(CoreError::SchemaViolation("invalid JSON literal".into()));
            }
            out.push_str("null");
            Ok(())
        }
        Some(b'-') | Some(b'0'..=b'9') => write_number_lexeme(out, text),
        _ => Err(CoreError::SchemaViolation(
            "spawn canonical JSON value is invalid".into(),
        )),
    }
}

fn write_object(out: &mut String, map: &BTreeMap<String, Box<RawValue>>) -> Result<(), CoreError> {
    out.push('{');
    for (index, (key, value)) in map.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_json_string(out, key);
        out.push(':');
        write_raw(out, value.get())?;
    }
    out.push('}');
    Ok(())
}

fn write_number_lexeme(out: &mut String, text: &str) -> Result<(), CoreError> {
    let value: f64 = text
        .parse()
        .map_err(|_| CoreError::SchemaViolation(format!("invalid JSON number {text}")))?;
    if !value.is_finite() {
        // JSON.parse of an overflowing number is Infinity, and JSON.stringify writes null.
        out.push_str("null");
        return Ok(());
    }
    let mut buffer = ryu_js::Buffer::new();
    out.push_str(buffer.format_finite(value));
    Ok(())
}

fn push_json_string(out: &mut String, text: &str) {
    out.push_str(&serde_json::to_string(text).expect("json string"));
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xf) as usize] as char);
    }
    out
}
