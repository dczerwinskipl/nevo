using System.Reflection;

namespace NEvo.Ddd.EventSourcing.Evolving;

public static class AggregateEvolverExtractor
{
    public static IEnumerable<(Type EventType, Type DeclaringType, Delegate Decider)> ExtractEvolvers(Type aggregateType)
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
        var internalExtractEvolvers = InternalExtractEvolversMethod.MakeGenericMethod(aggregateType, idType);

        return (IEnumerable<(Type, Type, Delegate)>)internalExtractEvolvers.Invoke(null, null)!;
    }

    private static bool IsEvent(this Type type)
        => type.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IAggregateEvent<,>));

    private static IEnumerable<Type> GetAllAggregateImplementations(Type aggregateType)
        => AppDomain.CurrentDomain.GetAssemblies()
            .SelectMany(assembly => assembly.GetTypes())
            .Where(aggregateType.IsAssignableFrom);

    private static IEnumerable<MethodInfo> WithValidReturnType(this IEnumerable<MethodInfo> methods, Type aggregateType)
        => methods
            .Where(m => aggregateType.IsAssignableFrom(m.ReturnType));

    private static IEnumerable<(MethodInfo Method, Type EventType)> WithEventInputParameter(this IEnumerable<MethodInfo> methods)
        => methods.Where(m => m.GetParameters().Length == 1)
            .Where(m => m.GetParameters()[0].ParameterType.IsEvent())
            .Select(m => (m, m.GetParameters()[0].ParameterType));

    private static readonly MethodInfo InternalExtractEvolversMethod = typeof(AggregateEvolverExtractor)
            .GetMethod(nameof(InternalExtractEvolvers), BindingFlags.Static | BindingFlags.NonPublic)!;

    private static IEnumerable<(Type EventType, Type DeclaringType, Delegate Decider)> InternalExtractEvolvers<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => GetAllAggregateImplementations(typeof(TAggregate))
            .SelectMany(type => type.GetMethods())
            .WithValidReturnType(typeof(TAggregate))
            .WithEventInputParameter()
            .Select(input => ToEvolver<TAggregate, TId>(input.Method, input.EventType));

    private static (Type EventType, Type DeclaringType, Delegate Decider) ToEvolver<TAggregate, TId>(MethodInfo method, Type eventType)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var createEvolver = CreateDecideMethod.MakeGenericMethod([typeof(TAggregate), typeof(TId)]);
        var evolver = (Delegate)createEvolver.Invoke(null, [method])!;
        return (eventType, method.DeclaringType!, evolver);
    }

    private static readonly MethodInfo CreateDecideMethod = typeof(AggregateEvolverExtractor)
                .GetMethod(nameof(CreateEvolve), BindingFlags.Static | BindingFlags.NonPublic)!;
    private static AggregateEvolver.EvolveDelegate<TAggregate, TId> CreateEvolve<TAggregate, TId>(MethodInfo methodInfo)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull => (aggregateOption, @event)
        => methodInfo.IsStatic ?
                aggregateOption.Match<Either<Exception, TAggregate>>(
                    Some: aggregate => new InvalidOperationException($"Aggregate {aggregate.GetType().Name} already exists"),
                    None: () => (TAggregate)methodInfo.Invoke(null, [@event])!
                ) :
                aggregateOption.Match<Either<Exception, TAggregate>>(
                    Some: aggregate => (TAggregate)methodInfo.Invoke(aggregate, [@event])!,
                    None: () => new InvalidOperationException("Aggregate doesn't exists")
                );
}