using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Deciding;

public static class AggregateDeciderExtractor
{
    public static IEnumerable<(Type CommandType, Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)> ExtractDeciders(Type aggregateType)
    {
        // Ensure the type implements IAggregateRoot<>
        var aggregateRootInterface = aggregateType
            .GetInterfaces()
            .FirstOrDefault(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IAggregateRoot<>));

        if (aggregateRootInterface == null)
        {
            return [];
        }

        var genericArguments = aggregateRootInterface.GetGenericArguments();
        var idType = genericArguments[0];
        var internalExtractDeciders = InternalExtractDecidersMethod.MakeGenericMethod(aggregateType, idType);

        return (IEnumerable<(Type, Type, Type, Type, Delegate)>)internalExtractDeciders.Invoke(null, null)!;
    }

    private static bool IsCommand(this Type type)
        => type.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IAggregateCommand<,>));

    private static bool IsEvent(this Type type)
        => type.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IAggregateEvent<,>));

    private static IEnumerable<Type> GetAllAggregateImplementations(Type aggregateType)
        => aggregateType.Assembly.GetTypes()
            .Where(aggregateType.IsAssignableFrom);

    private static IEnumerable<(MethodInfo Method, Type EventType)> WithValidReturnType(this IEnumerable<MethodInfo> methods)
        => methods
            .Where(m =>
                m.ReturnType.IsGenericType
                && m.ReturnType.GetGenericTypeDefinition() == typeof(Either<,>)
                && m.ReturnType.GenericTypeArguments[0].IsAssignableFrom(typeof(Exception))
                //TODO: allow other implementations and single event
                && m.ReturnType.GenericTypeArguments[1].GetGenericTypeDefinition() == typeof(IEnumerable<>)
                && m.ReturnType.GenericTypeArguments[1].GetGenericArguments()[0].IsEvent()
            )
            .Select(m => (m, m.ReturnType.GenericTypeArguments[1].GetGenericArguments()[0]));

    private static IEnumerable<(MethodInfo Method, Type EventType, Type CommandType)> WithCommandInputParameter(this IEnumerable<(MethodInfo Method, Type EventType)> methods)
        => methods.Where(m => m.Method.GetParameters().Length == 1)
            .Where(m => m.Method.GetParameters()[0].ParameterType.IsCommand())
            .Select(m => (m.Method, m.EventType, m.Method.GetParameters()[0].ParameterType));

    private static readonly MethodInfo InternalExtractDecidersMethod = typeof(AggregateDeciderExtractor)
            .GetMethod(nameof(InternalExtractDeciders), BindingFlags.Static | BindingFlags.NonPublic)!;

    private static IEnumerable<(Type CommandType, Type AggregateType, Type DeclaringType, Type IdType, Delegate decide)> InternalExtractDeciders<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => GetAllAggregateImplementations(typeof(TAggregate))
            .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static))
            .WithValidReturnType()
            .WithCommandInputParameter()
            .Select(input => ToDecider<TAggregate, TId>(input.Method, input.EventType, input.CommandType));

    private static (Type CommandType, Type AggregateType, Type DeclaringType, Type IdType, Delegate decider) ToDecider<TAggregate, TId>(MethodInfo method, Type eventType, Type commandType)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var createDecider = CreateDecideMethod.MakeGenericMethod([typeof(TAggregate), typeof(TId)]);
        var decider = (Delegate)createDecider.Invoke(null, [method])!;
        return (commandType, typeof(TAggregate), method.DeclaringType!, typeof(TId), decider);
    }

    private static readonly MethodInfo CreateDecideMethod = typeof(AggregateDeciderExtractor)
                .GetMethod(nameof(CreateDecide), BindingFlags.Static | BindingFlags.NonPublic)!;
    private static AggregateDecider.AggregateDecideDelegate<TAggregate, TId> CreateDecide<TAggregate, TId>(MethodInfo methodInfo)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull =>
        (aggregateOption, command) =>
            methodInfo.IsStatic ?
                aggregateOption.Match(
                    Some: aggregate => new InvalidOperationException($"Aggregate {aggregate.GetType().Name} already exists"),
                    None: () => methodInfo.Invoke(null, [command]).ToDeciderResult<TAggregate, TId>()
                ) :
                aggregateOption.Match(
                    Some: aggregate => methodInfo.Invoke(aggregate, [command]).ToDeciderResult<TAggregate, TId>(),
                    None: () => new InvalidOperationException("Aggregate doesn't exists")
                );

    private static Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> ToDeciderResult<TAggregate, TId>(this object? methodResult)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        dynamic result = methodResult!;
        return result.Map(
                (Func<IEnumerable<dynamic>, IEnumerable<IAggregateEvent<TAggregate, TId>>>)(
                    events => events.Cast<IAggregateEvent<TAggregate, TId>>()
                )
            );
    }
}