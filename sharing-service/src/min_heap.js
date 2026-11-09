/**
 * Binary Min Heap / Priority Queue implementation for Time Capsule Scheduling (Synopsis §6.3).
 * Guarantees O(log N) insert and extractMin operations and O(1) peek.
 * 
 * Space Complexity: O(N)
 * Insert (bubble-up): O(log N)
 * Extract-Min (heapify-down): O(log N)
 * Peek: O(1)
 */
class BinaryMinHeap {
    constructor() {
        this.heap = [];
    }

    _getTimestamp(priority) {
        if (!priority) return Infinity;
        if (priority instanceof Date) return priority.getTime();
        if (typeof priority === 'number') return priority;
        // Parse date strings formatted as 'YYYY-MM-DD HH:mm:ss' or ISO
        const iso = String(priority).replace(' ', 'T');
        const ts = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z').getTime();
        if (!isNaN(ts)) return ts;
        const fallback = new Date(priority).getTime();
        return isNaN(fallback) ? Infinity : fallback;
    }

    _parent(index) {
        return Math.floor((index - 1) / 2);
    }

    _leftChild(index) {
        return 2 * index + 1;
    }

    _rightChild(index) {
        return 2 * index + 2;
    }

    _swap(i, j) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }

    /**
     * Inserts an item with a priority into the heap and restores the min-heap invariant via bubble-up.
     */
    insert(item, priority) {
        const timestamp = this._getTimestamp(priority);
        const node = { item, priority, timestamp };
        this.heap.push(node);
        this._heapifyUp(this.heap.length - 1);
    }

    _heapifyUp(index) {
        let current = index;
        while (current > 0) {
            const parent = this._parent(current);
            if (this.heap[current].timestamp < this.heap[parent].timestamp) {
                this._swap(current, parent);
                current = parent;
            } else {
                break;
            }
        }
    }

    /**
     * Returns the earliest scheduled item without removing it.
     */
    peek() {
        if (this.heap.length === 0) return null;
        return this.heap[0].item;
    }

    peekNode() {
        if (this.heap.length === 0) return null;
        return this.heap[0];
    }

    /**
     * Removes and returns the item with the earliest unlock timestamp via heapify-down.
     */
    extractMin() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) {
            return this.heap.pop().item;
        }

        const minItem = this.heap[0].item;
        this.heap[0] = this.heap.pop();
        this._heapifyDown(0);
        return minItem;
    }

    pop() {
        return this.extractMin();
    }

    _heapifyDown(index) {
        let smallest = index;
        const left = this._leftChild(index);
        const right = this._rightChild(index);
        const length = this.heap.length;

        if (left < length && this.heap[left].timestamp < this.heap[smallest].timestamp) {
            smallest = left;
        }

        if (right < length && this.heap[right].timestamp < this.heap[smallest].timestamp) {
            smallest = right;
        }

        if (smallest !== index) {
            this._swap(index, smallest);
            this._heapifyDown(smallest);
        }
    }

    /**
     * Extracts all elements in strictly ascending chronological order without mutating the original heap.
     */
    toSortedArray() {
        const clone = new BinaryMinHeap();
        clone.heap = this.heap.map(n => ({ ...n }));
        const sorted = [];
        while (!clone.isEmpty()) {
            sorted.push(clone.extractMin());
        }
        return sorted;
    }

    /**
     * Rebuilds the min heap from an array of capsule records.
     */
    rebuild(capsules = []) {
        this.heap = [];
        for (const c of capsules) {
            if (c && c.reveal_date) {
                this.insert(c, c.reveal_date);
            }
        }
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    clear() {
        this.heap = [];
    }
}

module.exports = { BinaryMinHeap, PriorityQueue: BinaryMinHeap };

