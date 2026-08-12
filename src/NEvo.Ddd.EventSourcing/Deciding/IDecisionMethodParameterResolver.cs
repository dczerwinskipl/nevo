using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Resolves a single additional aggregate decision-method parameter (any parameter
/// after the command) by its declared type, reading the current invocation's DI scope —
/// never a value captured once at discovery/startup time.
/// </summary>
internal interface IDecisionMethodParameterResolver
{
    Either<Exception, object> Resolve(ParameterInfo parameter);
}
