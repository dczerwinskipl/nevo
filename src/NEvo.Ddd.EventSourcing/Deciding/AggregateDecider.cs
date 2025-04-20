namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Decider that use Aggregate instance to handle the command.
/// </summary>
public class AggregateDecider(IAggregateDeciderProvider aggregateDeciderProvider) : IDecider
{
    public delegate Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> AggregateDecideDelegate<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    private readonly IDictionary<Type, List<(Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)>> _deciders = aggregateDeciderProvider.GetAggregateDeciders();

    public EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
            => from decider in GetDeciderDelegate(aggregate.GetType(), command)
                    .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregate.GetType().Name}"))
               from events in decider(aggregate, command).ToAsync()
               select events;

    private Option<AggregateDecideDelegate<TAggregate, TId>> GetDeciderDelegate<TAggregate, TId>(Type aggregateType, IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull =>
        _deciders
            .TryGetValue(command.GetType())
            .SelectMany(x => x)
            .Where(decider => decider.DeclaringType.IsAssignableFrom(aggregateType))
            .ToOption()
            .Bind<AggregateDecideDelegate<TAggregate, TId>>(
                decider => decider.Decide as AggregateDecideDelegate<TAggregate, TId>
            );

    public bool CanHandle<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
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
