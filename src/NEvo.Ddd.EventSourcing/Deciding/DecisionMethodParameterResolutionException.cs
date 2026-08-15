using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// A declared aggregate decision-method parameter (beyond the command) could not be
/// resolved — the type is unregistered, an exception was raised while resolving or
/// activating it, or a resolved capability reported it has no current value for this
/// invocation. Declaring a parameter is the assertion that the decision requires it;
/// this exception is what the framework returns instead of invoking the decision method
/// partially.
/// </summary>
public sealed class DecisionMethodParameterResolutionException : Exception
{
    public DecisionMethodParameterResolutionException(ParameterInfo parameter, string reason, Exception? innerException = null)
        : base(FormatMessage(parameter, reason), innerException)
    {
    }

    private static string FormatMessage(ParameterInfo parameter, string reason)
        => $"Cannot resolve decision-method parameter '{parameter.Name}' of type " +
           $"'{parameter.ParameterType.Name}' declared on " +
           $"'{parameter.Member.DeclaringType?.Name}.{parameter.Member.Name}' — {reason}";
}
