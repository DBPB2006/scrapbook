class Stack {
    constructor() {
        this.items = [];
    }

    push(item) {
        this.items.push(item);
    }

    pop() {
        return this.items.pop();
    }

    isEmpty() {
        return this.items.length === 0;
    }

    toArray() {
        return [...this.items].reverse();
    }
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(month, year) {
    if (month < 1) { // Handle borrowing from January
        month = 12;
        year -= 1;
    }
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 && isLeapYear(year)) {
        return 29;
    }
    return days[month - 1];
}

function calculateTimeDifference(startDateTimeStr, endDateTimeStr) {
    const startParts = startDateTimeStr.split(' ');
    const endParts = endDateTimeStr.split(' ');
    if (startParts.length !== 2 || endParts.length !== 2) return null;

    const startDate = startParts[0].split('-');
    const startTime = startParts[1].split(':');
    const endDate = endParts[0].split('-');
    const endTime = endParts[1].split(':');
    if (startDate.length !== 3 || startTime.length !== 3 || endDate.length !== 3 || endTime.length !== 3) return null;

    const startAll = [...startDate, ...startTime].map(Number);
    const endAll = [...endDate, ...endTime].map(Number);

    const startStack = new Stack();
    const endStack = new Stack();
    startAll.forEach(val => startStack.push(val));
    endAll.forEach(val => endStack.push(val));

    const diffStack = new Stack();
    let borrow = 0;

    let startVal, endVal;

    // Seconds
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 60;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // Minutes
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 60;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // Hours
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 24;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // Days
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += getDaysInMonth(endAll[1] - 1, endAll[0]);
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // Months
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 12;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // Years
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    diffStack.push(endVal - startVal);

    return diffStack.toArray();
}

function displayTimeDifference(startDateTimeStr, endDateTimeStr) {
    if (isCapsuleUnlocked(endDateTimeStr)) {
        return "Unlocked";
    }

    const diff = calculateTimeDifference(startDateTimeStr, endDateTimeStr);
    if (diff === null) {
        return "Invalid date format";
    }
    
    return `${diff[5]}y ${diff[4]}m ${diff[3]}d ${diff[2]}h ${diff[1]}m ${diff[0]}s`;
}

function isCapsuleUnlocked(unlockDateTimeStr) {
    const now = new Date();
    // format now to YYYY-MM-DD HH:mm:ss
    const pad = (n) => n.toString().padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    
    return nowStr >= unlockDateTimeStr;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Stack,
        isLeapYear,
        getDaysInMonth,
        calculateTimeDifference,
        displayTimeDifference,
        isCapsuleUnlocked
    };
} else {
    window.Stack = Stack;
    window.isLeapYear = isLeapYear;
    window.getDaysInMonth = getDaysInMonth;
    window.calculateTimeDifference = calculateTimeDifference;
    window.displayTimeDifference = displayTimeDifference;
    window.isCapsuleUnlocked = isCapsuleUnlocked;
}
