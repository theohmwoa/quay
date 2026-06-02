//! A bounded ring-buffer of recent PTY output.
//!
//! Each terminal keeps the last N bytes it emitted so the frontend can detach
//! and reattach (or restart the app) and have its scrollback replayed instead
//! of facing a blank screen.

use std::collections::VecDeque;

/// Fixed-capacity byte buffer that keeps the most recent bytes written.
pub struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    capacity: usize,
}

impl ScrollbackBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(capacity.min(1 << 20)),
            capacity: capacity.max(1),
        }
    }

    /// Append `data`, evicting the oldest bytes beyond the capacity.
    pub fn push(&mut self, data: &[u8]) {
        // If the chunk alone exceeds capacity, keep only its tail.
        let data = if data.len() > self.capacity {
            &data[data.len() - self.capacity..]
        } else {
            data
        };
        self.buf.extend(data.iter().copied());
        while self.buf.len() > self.capacity {
            self.buf.pop_front();
        }
    }

    /// Current contents, oldest byte first.
    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_under_capacity() {
        let mut b = ScrollbackBuffer::new(100);
        b.push(b"hello ");
        b.push(b"world");
        assert_eq!(b.snapshot(), b"hello world");
        assert_eq!(b.snapshot().len(), 11);
    }

    #[test]
    fn evicts_oldest_beyond_capacity() {
        let mut b = ScrollbackBuffer::new(5);
        b.push(b"abc");
        b.push(b"defg"); // total "abcdefg" -> keep last 5 "cdefg"
        assert_eq!(b.snapshot(), b"cdefg");
        assert_eq!(b.snapshot().len(), 5);
    }

    #[test]
    fn a_single_oversized_write_keeps_its_tail() {
        let mut b = ScrollbackBuffer::new(4);
        b.push(b"0123456789");
        assert_eq!(b.snapshot(), b"6789");
    }

    #[test]
    fn capacity_is_at_least_one() {
        let mut b = ScrollbackBuffer::new(0);
        b.push(b"xyz");
        assert_eq!(b.snapshot(), b"z");
    }
}
