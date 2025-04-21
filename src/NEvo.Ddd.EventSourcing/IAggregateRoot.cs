namespace NEvo.Ddd.EventSourcing;

public interface IAggregateRoot<TId, TAggregateRoot> : IProjectable<TId>
    where TId : notnull
    where TAggregateRoot : IAggregateRoot<TId, TAggregateRoot>
{
}
