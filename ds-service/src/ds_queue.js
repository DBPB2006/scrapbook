class Queue {
    constructor() {
        this.items = [];
        this.frontIndex = 0;
    }

    enqueue(item) {
        this.items.push(item);
    }

    dequeue() {
        if (this.isEmpty()) {
            return undefined;
        }
        const item = this.items[this.frontIndex];
        this.frontIndex++;
        
        // Cleanup array occasionally to prevent memory leak
        if (this.frontIndex > 100 && this.frontIndex > this.items.length / 2) {
            this.items = this.items.slice(this.frontIndex);
            this.frontIndex = 0;
        }
        
        return item;
    }

    isEmpty() {
        return this.frontIndex >= this.items.length;
    }

    size() {
        return this.items.length - this.frontIndex;
    }
}

module.exports = { Queue };
