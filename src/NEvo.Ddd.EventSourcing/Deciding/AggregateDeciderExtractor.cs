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
            .Select(m => (m, EventType: m.ReturnType.GenericTypeArguments[1].GetGenericArguments()[0]))
            .Select(RequireEventDerivedType);

    // IAggregateEvent<,> alone doesn't guarantee Event — a decision method producing a
    // type that implements IAggregateEvent<,> but doesn't derive from Event would
    // otherwise be silently excluded here (indistinguishable from "not a decider at
    // all") and only fail much later, opaquely, when the executor tries to publish it.
    // Reject it loudly, at discovery time, naming exactly what's wrong.
    private static (MethodInfo Method, Type EventType) RequireEventDerivedType((MethodInfo Method, Type EventType) candidate)
    {
        if (!typeof(Event).IsAssignableFrom(candidate.EventType))
        {
            throw new InvalidOperationException(
                $"'{candidate.Method.DeclaringType!.Name}.{candidate.Method.Name}' is discovered as an " +
                $"aggregate-method convention decider producing '{candidate.EventType.Name}', which implements " +
                $"IAggregateEvent<,> but does not derive from NEvo.Messaging.Events.Event. The current NEvo " +
                $"Messaging integration requires publishable aggregate events to derive from Event — make " +
                $"'{candidate.EventType.Name}' derive from Event.");
        }

        return candidate;
    }

    // A candidate's parameter list is: exactly one command-typed parameter, always
    // first, followed by zero or more additional, framework-resolved parameters. A
    // method with no command-typed parameter at all is legitimately not a decider
    // (skipped, unchanged from before this mechanism existed). A method whose command
    // parameter is present but not first looks almost-but-not-quite like a decider —
    // that is a discovery-time error, not a silent skip, so a misplaced parameter
    // doesn't fail opaquely much later.
    private static IEnumerable<(MethodInfo Method, Type EventType, Type CommandType)> WithCommandInputParameter(this IEnumerable<(MethodInfo Method, Type EventType)> methods)
    {
        foreach (var m in methods)
        {
            var parameters = m.Method.GetParameters();
            if (parameters.Length == 0)
            {
                continue;
            }

            if (parameters[0].ParameterType.IsCommand())
            {
                yield return (m.Method, m.EventType, parameters[0].ParameterType);
                continue;
            }

            if (parameters.Any(p => p.ParameterType.IsCommand()))
            {
                throw new InvalidOperationException(
                    $"'{m.Method.DeclaringType!.Name}.{m.Method.Name}' is discovered as an aggregate-method " +
                    "convention candidate but declares its command-typed parameter after another parameter. The " +
                    "aggregate-method convention requires the command to be the first parameter, followed by zero " +
                    "or more additional, framework-resolved parameters.");
            }
        }
    }

    private static readonly MethodInfo InternalExtractDecidersMethod = typeof(AggregateDeciderExtractor)
            .GetMethod(nameof(InternalExtractDeciders), BindingFlags.Static | BindingFlags.NonPublic)!;

    private static IEnumerable<(Type CommandType, Type AggregateType, Type DeclaringType, Type IdType, Delegate decide)> InternalExtractDeciders<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        // DeclaredOnly: every assignable type is already its own entry in
        // GetAllAggregateImplementations, so an inherited instance method would
        // otherwise be re-extracted once per subclass, producing duplicate candidates
        // that all report the same (base) DeclaringType — a spurious same-type tie for
        // most-specific-wins resolution once a state type is three or more levels deep.
        => GetAllAggregateImplementations(typeof(TAggregate))
            .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
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
        (aggregateOption, command, parameterResolver) =>
            methodInfo.IsStatic ?
                aggregateOption.Match(
                    Some: aggregate => new InvalidOperationException($"Aggregate {aggregate.GetType().Name} already exists"),
                    None: () => InvokeDecide<TAggregate, TId>(methodInfo, null, command, parameterResolver)
                ) :
                aggregateOption.Match(
                    Some: aggregate => InvokeDecide<TAggregate, TId>(methodInfo, aggregate, command, parameterResolver),
                    None: () => new InvalidOperationException("Aggregate doesn't exist")
                );

    // Resolves every parameter after the command (per-invocation, via parameterResolver
    // — never cached from discovery time) before invoking the decision method at all, so
    // an unresolvable dependency short-circuits to a Left instead of a partial/garbled
    // invocation.
    private static Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> InvokeDecide<TAggregate, TId>(
        MethodInfo methodInfo,
        object? target,
        object command,
        IDecisionMethodParameterResolver parameterResolver)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => ResolveArguments(methodInfo.GetParameters(), command, parameterResolver)
            .Bind(arguments => Invoke<TAggregate, TId>(methodInfo, target, arguments));

    // A resolved parameter's own type can still fail once actually read (e.g. a
    // contextual capability whose value getter reports "no current value available" for
    // this invocation, such as ICurrentUser<TId,TUser>). Reflection wraps any such
    // exception in TargetInvocationException — unwrapped here so it surfaces as the same
    // typed Left the resolver itself uses, never a partially-produced result and never an
    // uncontrolled reflection exception escaping the call.
    private static Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> Invoke<TAggregate, TId>(
        MethodInfo methodInfo, object? target, object?[] arguments)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        try
        {
            return methodInfo.Invoke(target, arguments).ToDeciderResult<TAggregate, TId>();
        }
        catch (TargetInvocationException exception) when (exception.InnerException is not null)
        {
            return exception.InnerException;
        }
    }

    private static Either<Exception, object?[]> ResolveArguments(
        ParameterInfo[] parameters,
        object command,
        IDecisionMethodParameterResolver parameterResolver)
    {
        var arguments = new object?[parameters.Length];
        arguments[0] = command;
        return ResolveFrom(1).Map(_ => arguments);

        Either<Exception, Unit> ResolveFrom(int index)
        {
            if (index >= parameters.Length)
            {
                return Unit.Default;
            }

            return parameterResolver.Resolve(parameters[index]).Bind(value =>
            {
                arguments[index] = value;
                return ResolveFrom(index + 1);
            });
        }
    }

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