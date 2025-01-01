
using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Deciding;

public class DecideHandlerProvider<TAggregate, TKey, TCommand, TEvent> : IDecideHandlerFactoryProvider<TAggregate, TKey, TCommand, TEvent>
    where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
    where TCommand : EventSourcedCommand<TKey>
{
    private readonly Dictionary<Type, DecideAsyncHandlerFactory<TAggregate, TKey, TCommand, TEvent>> _handlers = new();

    public DecideHandlerProvider(Type type)
    {
        CacheHandlers(type);
    }

    private void CacheHandlers(Type decideStaticClass)
    {
        var methods = decideStaticClass.GetMethods(BindingFlags.Public | BindingFlags.Static);
        foreach (var method in methods)
        {
            var attribute = method.GetCustomAttribute<DecisionHandlerAttribute>();
            if (attribute == null)
                continue;

            // TODO: handle async version as well
            if (IsValid(method, out var parameters, out var commandType))
            {
                _handlers[commandType!] = (sp) => (aggregate, command, CancellationToken) =>
                {
                    var methodParameters = GetInputParameters(sp, aggregate, command, parameters);
                    return Task.FromResult((Either<Exception, IEnumerable<TEvent>>)method.Invoke(null, methodParameters)!);
                };
            }
        }
    }

    private static bool IsValid(MethodInfo method, out ParameterInfo[] parameters, out Type? commandType)
    {
        parameters = method.GetParameters();
        if (parameters.Length < 2)
        {
            commandType = null;
            return false;
        }

        var aggregateType = parameters[0].ParameterType;
        commandType = parameters[1].ParameterType;

        if (!typeof(TAggregate).IsAssignableFrom(aggregateType) || !typeof(TCommand).IsAssignableFrom(commandType))
        {
            commandType = null;
            return false;
        }

        return true;
    }

    private static object[] GetInputParameters(IServiceProvider sp, TAggregate aggregate, TCommand command, ParameterInfo[] parameters)
    {
        var methodParameters = new object[parameters.Length];
        methodParameters[0] = aggregate;
        methodParameters[1] = command;

        for (int i = 2; i < parameters.Length; i++)
        {
            var serviceType = parameters[i].ParameterType;
            methodParameters[i] = sp.GetRequiredService(serviceType);
        }

        return methodParameters;
    }

    public DecideAsyncHandlerFactory<TAggregate, TKey, TCommand, TEvent> GetHandlerFactory(Type commandType)
    {
        if (_handlers.TryGetValue(commandType, out var handler))
        {
            return handler;
        }

        throw new InvalidOperationException($"No handler found for command type {commandType}");
    }

    public IEnumerable<Type> GetCommandTypes() => _handlers.Keys;
}