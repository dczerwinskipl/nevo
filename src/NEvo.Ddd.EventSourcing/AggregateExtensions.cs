using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing;

public static class AggregateExtensions
{
    public static EitherAsync<Exception, TAggregate> ExecuteAsync<TAggregate, TId>(
        this TAggregate aggregate,
        IDecider decider,
        IEvolver evolver,
        IAggregateCommand<TAggregate, TId> command,
        CancellationToken cancellationToken
    )
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
        => decider.DecideAsync(
            aggregate,
            command,
            cancellationToken
        ).Bind(events => events.Aggregate(
                Either<Exception, TAggregate>.Right(aggregate),
                (currentAggregate, @event) => currentAggregate.Bind(aggregate =>
                    evolver.Evolve(aggregate, @event)
                )
            ).ToAsync()
        );
}
