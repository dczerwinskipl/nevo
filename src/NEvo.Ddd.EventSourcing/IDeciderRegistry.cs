using LanguageExt;

namespace NEvo.Ddd.EventSourcing;

public interface IDeciderRegistry
{
    public Option<IDecider> GetDecider<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : AggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;
}
