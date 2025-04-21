namespace NEvo.Ddd.EventSourcing;

public interface IAggregateRoot<TId> : IProjectable<TId>
    where TId : notnull
{
}
