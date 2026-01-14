/**
 * Utility functions for formatting numbers with dynamic precision
 * to properly display very small values (e.g., 0.00001)
 */

/**
 * Format a number to show significant digits, especially for very small values.
 * - For values >= 0.0001: Shows 4 decimal places
 * - For smaller values: Shows enough decimals to display 2 significant digits
 *
 * @param value - The number to format
 * @param minDecimals - Minimum decimal places to show (default: 4)
 * @param maxDecimals - Maximum decimal places to show (default: 8)
 * @returns Formatted string representation
 */
export const formatTokenAmount = (
    value: number,
    minDecimals: number = 4,
    maxDecimals: number = 8,
): string => {
    if (value === 0) return "0";
    if (!isFinite(value)) return "0";

    const absValue = Math.abs(value);

    // For values >= 0.0001, use standard fixed formatting
    if (absValue >= 0.0001) {
        return value.toFixed(minDecimals);
    }

    // For very small values, find appropriate precision
    // We want to show at least 2 significant digits
    let decimals = minDecimals;
    let formatted = value.toFixed(decimals);

    // Keep increasing decimals until we see non-zero digits or hit max
    while (parseFloat(formatted) === 0 && decimals < maxDecimals) {
        decimals++;
        formatted = value.toFixed(decimals);
    }

    // If still zero at max decimals, return scientific notation or zero
    if (parseFloat(formatted) === 0) {
        if (absValue > 0) {
            // Show in scientific notation for extremely small values
            return value.toExponential(2);
        }
        return "0";
    }

    return formatted;
};

/**
 * Format a number for currency display (USD)
 *
 * @param value - The number to format
 * @param minDecimals - Minimum decimal places (default: 2)
 * @param maxDecimals - Maximum decimal places (default: 6)
 * @returns Formatted string representation
 */
export const formatCurrency = (
    value: number,
    minDecimals: number = 2,
    maxDecimals: number = 6,
): string => {
    if (value === 0) return "0.00";
    if (!isFinite(value)) return "0.00";

    const absValue = Math.abs(value);

    // For values >= 0.01, use standard fixed formatting
    if (absValue >= 0.01) {
        return value.toFixed(minDecimals);
    }

    // For very small values, find appropriate precision
    let decimals = minDecimals;
    let formatted = value.toFixed(decimals);

    while (parseFloat(formatted) === 0 && decimals < maxDecimals) {
        decimals++;
        formatted = value.toFixed(decimals);
    }

    if (parseFloat(formatted) === 0 && absValue > 0) {
        return value.toExponential(2);
    }

    return formatted;
};

/**
 * Format a percentage value
 *
 * @param value - The percentage value to format
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string with % suffix
 */
export const formatPercentage = (value: number, decimals: number = 2): string => {
    if (!isFinite(value)) return "∞";
    return `${value.toFixed(decimals)}%`;
};
