using System.Diagnostics;
using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Decider that use Aggregate instance to handle the command.
/// </summary>
public class AggregateDecider : IDecider
{
    // TODO: add DI with some registry?
    // TODO: and/or replace Type with some options
    public AggregateDecider(Type[] aggregateTypes)
    {
        if (_deciders.Count == 0)
        {
            var deciders = aggregateTypes
                .SelectMany(DeciderExtensions.ExtractDeciders)
                .ToList();

            foreach (var decider in deciders)
            {
                _deciders.Add(decider.Item1, (decider.Item2, decider.Item3));
            }
        }
    }

    public EitherAsync<Exception, IEnumerable<TEvent>> DecideAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, TAggregate aggregate, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull
            => from decider in GetDecider<TCommand, TAggregate, TEvent, TId>(aggregate)
                    .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregate.GetType().Name}"))
               from events in decider(aggregate, command).ToAsync()
               select events;

    public delegate Either<Exception, IEnumerable<TEvent>> Decide<TCommand, TAggregate, TEvent, TId>(TAggregate aggregate, TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull;

    private static readonly IDictionary<Type, (Type AggregateType, Delegate Decide)> _deciders = new Dictionary<Type, (Type AggregateType, Delegate Decide)>();

    private static Option<Decide<TCommand, TAggregate, TEvent, TId>> GetDecider<TCommand, TAggregate, TEvent, TId>(TAggregate aggregate)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull =>
        _deciders
            .TryGetValue(typeof(TCommand))
            .ToOption()
            .Where(decider => aggregate.GetType().IsAssignableFrom(decider.AggregateType))
            .Bind<Decide<TCommand, TAggregate, TEvent, TId>>(
                decider => decider.Decide as Decide<TCommand, TAggregate, TEvent, TId>
            );
}

public static class DeciderExtensions
{
    public static IEnumerable<(Type, Type, Delegate)> ExtractDeciders(Type aggregateType)
    {
        // Ensure the type implements IAggregateRoot<,>
        var aggregateRootInterface = aggregateType
            .GetInterfaces()
            .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IAggregateRoot<,>));

        if (aggregateRootInterface == null)
        {
            return [];
        }

        var genericArguments = aggregateRootInterface.GetGenericArguments();
        var idType = genericArguments[0];
        var aggregateGenericType = genericArguments[1];

        var method = typeof(DeciderExtensions)
            .GetMethod(nameof(InternalExtractDeciders), BindingFlags.Static | BindingFlags.NonPublic)!
            .MakeGenericMethod(aggregateGenericType, idType);

        return (IEnumerable<(Type, Type, Delegate)>)method.Invoke(null, null)!;
    }

    private static IEnumerable<(Type, Type, Delegate)> InternalExtractDeciders<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
    {
        // extract methods by pattern:
        // -- return type: Either<Exception, IEnumerable<TEvent>>
        // -- method parameters: IAggregateCommand<TAggregate, TId> command
        // -- method name: any
        // -- todo: add DI, add different approaches then schema above (Either, EitherAsync, maybe ignore, etc.)
        //          replace static decider with DI and extensibility, instead of scanning, use registration?
        var aggregateTypes = AppDomain.CurrentDomain.GetAssemblies()
            .SelectMany(assembly => assembly.GetTypes())
            .Where(type => typeof(TAggregate).IsAssignableFrom(type) && type != typeof(TAggregate))
            .ToList();

        var allMethods = aggregateTypes
            .SelectMany(type => type.GetMethods());

        var methodsWithEitherReturnType = allMethods
            .Where(m => m.ReturnType.IsGenericType && m.ReturnType.GetGenericTypeDefinition() == typeof(Either<,>));

        var methodsWithSingleParameter = methodsWithEitherReturnType
            .Where(m => m.GetParameters().Length == 1);

        var methodsWithAggregateCommandParameter = methodsWithSingleParameter
            .Where(m => m.GetParameters()[0].ParameterType.GetInterfaces()
                .Any(i => i == typeof(IAggregateCommand<TAggregate, TId>)));

        var methods = methodsWithAggregateCommandParameter
            .Select(m => new { m.DeclaringType, Method = m, Parameters = m.GetParameters() })
            .ToList();

        return methods.Select(m =>
        {
            var commandType = m.Parameters[0].ParameterType;
            var eventType = m.Method.ReturnType.GenericTypeArguments[1].GetGenericArguments()[0];
            var deciderType = typeof(AggregateDecider.Decide<,,,>).MakeGenericType(commandType, typeof(TAggregate), eventType, typeof(TId));

            var createDecideMethod = typeof(DeciderExtensions)
                .GetMethod(nameof(CreateDecide), BindingFlags.Static | BindingFlags.NonPublic)!
                .MakeGenericMethod(commandType, typeof(TAggregate), eventType, typeof(TId));

            var decider = (Delegate)createDecideMethod.Invoke(null, [m.Method])!;
            return (commandType, m.DeclaringType!, decider);
        });
    }

    private static AggregateDecider.Decide<TCommand, TAggregate, TEvent, TId> CreateDecide<TCommand, TAggregate, TEvent, TId>(
        MethodInfo methodInfo
    )
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull
    {
        return (aggregate, command) =>
        {
            var result = methodInfo.Invoke(aggregate, [command]);
            return (Either<Exception, IEnumerable<TEvent>>)result!;
        };
    }
}