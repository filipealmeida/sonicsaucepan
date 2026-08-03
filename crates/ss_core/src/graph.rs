use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Result, SsError};

pub type NodeId = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChordHandle {
    FamilyRef { family_index: usize, chord_index: usize },
    InlineName { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StateNode {
    pub id: NodeId,
    pub chord: ChordHandle,
    pub next: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoopGraph {
    pub initial_id: NodeId,
    pub nodes: BTreeMap<NodeId, StateNode>,
    next_id: NodeId,
}

impl LoopGraph {
    pub fn new(initial_chord: ChordHandle) -> Self {
        let initial_id = 0;
        let mut nodes = BTreeMap::new();
        nodes.insert(
            initial_id,
            StateNode {
                id: initial_id,
                chord: initial_chord,
                next: initial_id,
            },
        );

        Self {
            initial_id,
            nodes,
            next_id: 1,
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn get(&self, node_id: NodeId) -> Option<&StateNode> {
        self.nodes.get(&node_id)
    }

    pub fn add_after(&mut self, after_id: NodeId, chord: ChordHandle) -> Result<NodeId> {
        let existing_next = self
            .nodes
            .get(&after_id)
            .ok_or(SsError::NodeNotFound(after_id))?
            .next;

        let new_id = self.next_id;
        self.next_id += 1;

        self.nodes.insert(
            new_id,
            StateNode {
                id: new_id,
                chord,
                next: existing_next,
            },
        );

        let after_node = self
            .nodes
            .get_mut(&after_id)
            .ok_or(SsError::NodeNotFound(after_id))?;
        after_node.next = new_id;

        Ok(new_id)
    }

    pub fn remove(&mut self, node_id: NodeId) -> Result<()> {
        if node_id == self.initial_id {
            return Err(SsError::CannotRemoveInitialNode);
        }

        let target_next = self
            .nodes
            .get(&node_id)
            .ok_or(SsError::NodeNotFound(node_id))?
            .next;

        let predecessor_id = self
            .nodes
            .values()
            .find(|node| node.next == node_id)
            .map(|node| node.id)
            .ok_or(SsError::NodeNotFound(node_id))?;

        let predecessor = self
            .nodes
            .get_mut(&predecessor_id)
            .ok_or(SsError::NodeNotFound(predecessor_id))?;
        predecessor.next = target_next;

        self.nodes.remove(&node_id);
        Ok(())
    }

    pub fn ordered_cycle(&self, max_steps: usize) -> Result<Vec<NodeId>> {
        let mut out = Vec::new();
        if self.nodes.is_empty() {
            return Ok(out);
        }

        let mut cursor = self.initial_id;
        for _ in 0..max_steps {
            out.push(cursor);
            let next = self
                .nodes
                .get(&cursor)
                .ok_or(SsError::NodeNotFound(cursor))?
                .next;
            cursor = next;
            if cursor == self.initial_id {
                out.push(cursor);
                break;
            }
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn initial_graph() -> LoopGraph {
        LoopGraph::new(ChordHandle::InlineName {
            name: "Cmaj7".to_string(),
        })
    }

    #[test]
    fn insert_splices_outgoing_edge() {
        let mut g = initial_graph();
        let new_id = g
            .add_after(
                0,
                ChordHandle::InlineName {
                    name: "Dm7".to_string(),
                },
            )
            .expect("insert should succeed");

        assert_eq!(new_id, 1);
        assert_eq!(g.get(0).expect("node 0").next, 1);
        assert_eq!(g.get(1).expect("node 1").next, 0);
        assert_eq!(g.len(), 2);
    }

    #[test]
    fn remove_reconnects_predecessor() {
        let mut g = initial_graph();
        let n1 = g
            .add_after(
                0,
                ChordHandle::InlineName {
                    name: "Dm7".to_string(),
                },
            )
            .expect("n1 insert");
        let n2 = g
            .add_after(
                n1,
                ChordHandle::InlineName {
                    name: "G7".to_string(),
                },
            )
            .expect("n2 insert");

        g.remove(n1).expect("remove n1");

        assert_eq!(g.get(0).expect("node 0").next, n2);
        assert!(g.get(n1).is_none());
        assert_eq!(g.get(n2).expect("node n2").next, 0);
    }

    #[test]
    fn initial_node_cannot_be_removed() {
        let mut g = initial_graph();
        let err = g.remove(0).expect_err("must reject initial remove");
        assert!(matches!(err, SsError::CannotRemoveInitialNode));
    }
}
