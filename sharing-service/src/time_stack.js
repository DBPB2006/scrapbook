/**
 * Stack (LIFO) and Borrow Arithmetic for Time Calculation (Synopsis §6.3).
 * Uses LIFO stack operations to compute calendar-accurate countdown differences
 * between timestamps by pushing date components [year, month, day, hour, min, sec]
 * and popping in reverse order (sec -> min -> hr -> day -> mon -> yr) with borrowing.
 */

class TimeStack {
    constructor() {
        this.items = [];
    }

    push(item) {
        this.items.push(item);
    }

    pop() {
        if (this.isEmpty()) return undefined;
        return this.items.pop();
    }

    peek() {
        if (this.isEmpty()) return undefined;
        return this.items[this.items.length - 1];
    }

    isEmpty() {
        return this.items.length === 0;
    }

    size() {
        return this.items.length;
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

/**
 * Calculates remaining countdown difference between start and end timestamps using LIFO stacks.
 * Returns array of [seconds, minutes, hours, days, months, years] differences.
 */
function calculateTimeDifference(startDateTimeStr, endDateTimeStr) {
    if (!startDateTimeStr || !endDateTimeStr) return null;

    // Normalize ISO strings to "YYYY-MM-DD HH:mm:ss"
    const normalize = (s) => {
        if (s instanceof Date) {
            const pad = (n) => n.toString().padStart(2, '0');
            return `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())} ${pad(s.getHours())}:${pad(s.getMinutes())}:${pad(s.getSeconds())}`;
        }
        return String(s).replace('T', ' ').replace('Z', '').split('.')[0];
    };

    const sStr = normalize(startDateTimeStr);
    const eStr = normalize(endDateTimeStr);

    const startParts = sStr.split(' ');
    const endParts = eStr.split(' ');
    if (startParts.length !== 2 || endParts.length !== 2) return null;

    const startDate = startParts[0].split('-');
    const startTime = startParts[1].split(':');
    const endDate = endParts[0].split('-');
    const endTime = endParts[1].split(':');
    if (startDate.length !== 3 || startTime.length !== 3 || endDate.length !== 3 || endTime.length !== 3) return null;

    const startAll = [...startDate, ...startTime].map(Number);
    const endAll = [...endDate, ...endTime].map(Number);
    if (startAll.some(isNaN) || endAll.some(isNaN)) return null;

    const startStack = new TimeStack();
    const endStack = new TimeStack();
    startAll.forEach(val => startStack.push(val));
    endAll.forEach(val => endStack.push(val));

    const diffStack = new TimeStack();
    let borrow = 0;

    let startVal, endVal;

    // 1. Seconds (borrow 60 from minutes)
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 60;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // 2. Minutes (borrow 60 from hours)
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 60;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // 3. Hours (borrow 24 from days)
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 24;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // 4. Days (borrow days of previous month from months)
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += getDaysInMonth(endAll[1] - 1, endAll[0]);
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // 5. Months (borrow 12 from years)
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    if (endVal < startVal) {
        endVal += 12;
        borrow = 1;
    } else {
        borrow = 0;
    }
    diffStack.push(endVal - startVal);

    // 6. Years
    startVal = startStack.pop();
    endVal = endStack.pop() - borrow;
    diffStack.push(endVal - startVal);

    return diffStack.toArray();
}

/**
 * Authoritatively determines whether a capsule has passed its unlock date.
 */
function isCapsuleUnlocked(unlockDateTimeStr) {
    if (!unlockDateTimeStr) return false;
    const now = new Date();
    
    // Parse target date safely
    let target;
    if (unlockDateTimeStr instanceof Date) {
        target = unlockDateTimeStr;
    } else {
        const iso = String(unlockDateTimeStr).replace(' ', 'T');
        target = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z');
        if (isNaN(target.getTime())) {
            target = new Date(unlockDateTimeStr);
        }
    }
    
    if (!target || isNaN(target.getTime())) return false;
    return now >= target;
}

function displayTimeDifference(startDateTimeStr, endDateTimeStr) {
    if (isCapsuleUnlocked(endDateTimeStr)) {
        return "Unlocked";
    }

    const diff = calculateTimeDifference(startDateTimeStr, endDateTimeStr);
    if (diff === null) {
        return "Invalid date format";
    }

    // diff: [years, months, days, hours, minutes, seconds]
    return `${diff[0]}y ${diff[1]}m ${diff[2]}d ${diff[3]}h ${diff[4]}m ${diff[5]}s`;
}

module.exports = {
    TimeStack,
    Stack: TimeStack,
    isLeapYear,
    getDaysInMonth,
    calculateTimeDifference,
    displayTimeDifference,
    isCapsuleUnlocked
};
