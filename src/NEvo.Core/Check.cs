using System.Runtime.CompilerServices;

namespace NEvo.Core;


/// <summary>
/// Helper methods to simplify param checking
/// </summary>
public static class Check
{
    /// <summary>
    /// Returns value provided as first argument or throw exception if value is null
    /// </summary>
    /// <typeparam name="TValue">Type of value</typeparam>
    /// <param name="value">Value to check</param>
    /// <param name="message">Optional, message for exception</param>
    /// <param name="paramName">Optional, parameter name for exception</param>
    /// <returns>Provided value</returns>
    /// <exception cref="ArgumentNullException">Throws when provided value is null</exception>
    public static TValue Null<TValue>(TValue? value, string? message = null, [CallerArgumentExpression(nameof(value))] string? paramName = null)
    {
        return value ?? throw new ArgumentNullException(paramName, message);
    }

    /// <summary>
    /// Returns value provided as first argument or throw exception if value is null or empty
    /// </summary>
    /// <param name="value">Value to check</param>
    /// <param name="message">Optional, message for exception</param>
    /// <param name="paramName">Optional, parameter name for exception</param>
    /// <returns>Provided value</returns>
    /// <exception cref="ArgumentNullException">Throws when provided value is null or empty</exception>
    public static string NullOrEmpty(string? value, string? message = null, [CallerArgumentExpression(nameof(value))] string? paramName = null)
    {
        return !string.IsNullOrEmpty(value) ? value : throw new ArgumentNullException(paramName, message);
    }

    /// <summary>
    /// Returns value provided as first argument or throw exception if value is set to default
    /// </summary>
    /// <typeparam name="TValue">Type of value</typeparam>
    /// <param name="value">Value to check</param>
    /// <param name="message">Optional, message for exception</param>
    /// <param name="paramName">Optional, parameter name for exception</param>
    /// <returns>Provided value</returns>
    /// <exception cref="ArgumentNullException">Throws when provided value is set to default</exception>
    public static TValue Default<TValue>(TValue value, string? message = null, [CallerArgumentExpression(nameof(value))] string? paramName = null) where TValue : struct
    {
        return !EqualityComparer<TValue>.Default.Equals(value, default) ? value : throw new ArgumentNullException(paramName, message);
    }
}