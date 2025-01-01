using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Evolving;

public class EvolveHandlerProvider<TAggregate, TKey, TEvent> : IEvolveHandlerFactoryProvider<TAggregate, TKey, TEvent>
        where TAggregate : EventSourcedAggregate<TKey>
        where TEvent : EventSourcedEvent<TKey>
{
    private readonly Dictionary<Type, Func<TAggregate, TEvent, TAggregate>> _handlers = new();

    public EvolveHandlerProvider(Type type) => CacheHandlers(type);

    private void CacheHandlers(Type evolveStaticClass)
    {
        var methods = evolveStaticClass.GetMethods(BindingFlags.Public | BindingFlags.Static);
        foreach (var method in methods)
        {
            var attribute = method.GetCustomAttribute<EvolutionHandlerAttribute>();
            if (attribute == null)
                continue;

            if (IsValid(method, out var parameters, out var eventType))
            {
                _handlers[eventType!] = (aggregate, @event) =>
                {
                    var methodParameters = GetInputParameters(aggregate, @event, parameters);
                    return (TAggregate)method.Invoke(null, methodParameters)!;
                };
            }
        }
    }

    private static bool IsValid(MethodInfo method, out ParameterInfo[] parameters, out Type? eventType)
    {
        parameters = method.GetParameters();
        if (parameters.Length < 2)
        {
            eventType = null;
            return false;
        }

        var aggregateType = parameters[0].ParameterType;
        eventType = parameters[1].ParameterType;

        if (!typeof(TAggregate).IsAssignableFrom(aggregateType) || !typeof(TEvent).IsAssignableFrom(eventType))
        {
            eventType = null;
            return false;
        }

        return true;
    }

    private static object[] GetInputParameters(TAggregate aggregate, TEvent @event, ParameterInfo[] parameters)
    {
        var methodParameters = new object[parameters.Length];
        methodParameters[0] = aggregate;
        methodParameters[1] = @event;

        return methodParameters;
    }

    public Func<TAggregate, TEvent, TAggregate> GetHandlerFactory(Type eventType)
    {
        if (_handlers.TryGetValue(eventType, out var handler))
        {
            return handler;
        }

        throw new InvalidOperationException($"No handler found for event type {eventType}");
    }
}