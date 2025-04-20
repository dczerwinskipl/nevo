namespace NEvo.Ddd.EventSourcing;

public interface IProjectable<TId> where TId : notnull
{
    public TId Id { get; }
};
