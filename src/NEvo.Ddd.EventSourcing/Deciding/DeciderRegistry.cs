namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderRegistry(IEnumerable<IDecider> deciders) : IDeciderRegistry
{
    private readonly List<IDecider> _deciders = deciders.ToList();

    public IEnumerable<DeciderDescription> GetDeciderDesciptions()
        => _deciders.SelectMany(d => d.GetDeciderDescriptions());

    public Option<IDecider> GetDecider<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
        => _deciders
            .Where(d => d.CanHandle<TCommand, TAggregate, TId>(command))
            .ToOption();
}
