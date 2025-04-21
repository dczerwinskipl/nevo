using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing;

public static class AggregateExtensions
{
    public static EitherAsync<Exception, TAggregate> ExecuteAsync<TAggregate, TId>(
        this Option<TAggregate> aggregateOption,
        IDecider decider,
        IEvolver evolver,
        IAggregateCommand<TAggregate, TId> command,
        CancellationToken cancellationToken
    )
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => decider.DecideAsync(
            aggregateOption,
            command,
            cancellationToken
        ).Bind(events =>
        {
            if (!events.Any())
            {
                return aggregateOption
                    .ToEitherAsync(() => new Exception($"No events generated for command {command.GetType().Name} and empty aggregate"));
            }

            var aggregate = evolver.Evolve(aggregateOption, events.First());
            foreach (var @event in events.Skip(1))
            {
                aggregate = aggregate.Bind(agg => evolver.Evolve(agg, @event));
            }

            return aggregate.ToAsync();
        });
}
