using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Resolves and invokes the aggregate-method decision for a command by inspecting the
/// current aggregate instance's runtime type. The current implementation of both
/// <see cref="Deciding.IDecider"/> (the general decision-mechanism registry
/// abstraction) and <see cref="IAggregateMethodDecider"/> (the stable, purpose-specific
/// capability an explicit Event Sourced handler delegates to).
/// </summary>
public class AggregateDecider(IAggregateDeciderProvider aggregateDeciderProvider, IMessageContextAccessor messageContextAccessor) : IDecider, IAggregateMethodDecider
{
    // Internal machinery only, never referenced outside this assembly — free to evolve
    // independently of IAggregateMethodDecider's stable public contract.
    internal delegate Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> AggregateDecideDelegate<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateCommand<TAggregate, TId> command, IDecisionMethodParameterResolver parameterResolver)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    private readonly IDictionary<Type, List<(Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)>> _deciders = aggregateDeciderProvider.GetAggregateDeciders();
    // Constructed once (this class is Singleton) but reads the current invocation's
    // scope at resolve-time via IMessageContextAccessor, not at construction time — see
    // DecisionMethodParameterResolver.
    private readonly IDecisionMethodParameterResolver _parameterResolver = new DecisionMethodParameterResolver(messageContextAccessor);

    public EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(Option<TAggregate> aggregateOption, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var aggregateType = aggregateOption.Map(a => a.GetType()).IfNone(typeof(TAggregate));
        return from decider in GetDeciderDelegate(aggregateType, command).ToAsync()
               from events in decider(aggregateOption, command, _parameterResolver).ToAsync()
               select events;
    }

    private Either<Exception, AggregateDecideDelegate<TAggregate, TId>> GetDeciderDelegate<TAggregate, TId>(Type aggregateType, IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var candidates = _deciders
            .TryGetValue(command.GetType())
            .Map(matches => matches.Where(decider => decider.DeclaringType.IsAssignableFrom(aggregateType)).ToList())
            .IfNone([]);

        return MostSpecificCandidateResolver.Resolve(
            candidates,
            candidate => candidate.DeclaringType,
            notFound: () => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregateType.Name}"),
            ambiguous: tied => new Exception(
                $"Ambiguous decider for command {command.GetType().Name} on aggregate {aggregateType.Name}: " +
                $"{tied.Count} equally-specific candidates found, declared on {string.Join(", ", tied.Select(t => t.DeclaringType.Name))}."
            )
        ).Bind(candidate => CastDelegate<TAggregate, TId>(candidate, aggregateType, command));
    }

    private static Either<Exception, AggregateDecideDelegate<TAggregate, TId>> CastDelegate<TAggregate, TId>(
        (Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide) candidate,
        Type aggregateType,
        IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        if (candidate.Decide is AggregateDecideDelegate<TAggregate, TId> typed)
        {
            return typed;
        }

        return new Exception($"Decider for command {command.GetType().Name} on aggregate {aggregateType.Name} has an unexpected delegate shape.");
    }

    public bool CanHandle<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull => _deciders
            .TryGetValue(command.GetType()).IsSome;

    public IEnumerable<DeciderDescription> GetDeciderDescriptions()
        => _deciders
            .SelectMany(
                decider => decider.Value.Select(
                    x => new DeciderDescription
                    {
                        CommandType = decider.Key,
                        AggregateType = x.AggregateType,
                        DeclaringType = x.DeclaringType,
                        IdType = x.IdType,
                        DeciderType = typeof(AggregateDecider)
                    }
                )
            );
}
