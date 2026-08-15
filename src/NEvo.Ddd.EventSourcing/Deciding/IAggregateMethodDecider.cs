namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Executes the aggregate-method decision convention for the given current state and
/// command — the capability an explicit Event Sourced handler delegates to instead of
/// duplicating an aggregate's transition logic. Distinct from <see cref="IDecider"/>:
/// that is the general, possibly-multi-implementation registry abstraction
/// <see cref="IDeciderRegistry"/> collects; this is a stable name for the specific,
/// currently-supported aggregate-method convention, independent of which concrete
/// reflection/discovery implementation currently backs it.
/// </summary>
public interface IAggregateMethodDecider
{
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;
}
