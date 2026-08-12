using System.Reflection;
using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// DI-backed <see cref="IDecisionMethodParameterResolver"/> — resolves by parameter
/// <see cref="Type"/> through <see cref="IMessageContext.ServiceProvider"/>, read at
/// resolve-time via <see cref="IMessageContextAccessor"/> so a singleton-held resolver
/// still observes the current invocation's scope rather than the root container.
/// </summary>
internal sealed class DecisionMethodParameterResolver(IMessageContextAccessor messageContextAccessor) : IDecisionMethodParameterResolver
{
    public Either<Exception, object> Resolve(ParameterInfo parameter)
    {
        var serviceProvider = messageContextAccessor.MessageContext?.ServiceProvider;
        if (serviceProvider is null)
        {
            return new InvalidOperationException(
                $"Cannot resolve decision-method parameter '{parameter.Name}' of type " +
                $"'{parameter.ParameterType.Name}' declared on " +
                $"'{parameter.Member.DeclaringType?.Name}.{parameter.Member.Name}' — no current message context is " +
                "available.");
        }

        var service = serviceProvider.GetService(parameter.ParameterType);
        if (service is null)
        {
            return new InvalidOperationException(
                $"Cannot resolve decision-method parameter '{parameter.Name}' of type " +
                $"'{parameter.ParameterType.Name}' declared on " +
                $"'{parameter.Member.DeclaringType?.Name}.{parameter.Member.Name}' — no service registered for " +
                $"'{parameter.ParameterType.Name}'.");
        }

        return service;
    }
}
