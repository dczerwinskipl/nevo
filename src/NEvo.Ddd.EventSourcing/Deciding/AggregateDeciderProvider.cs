using Microsoft.Extensions.Options;

namespace NEvo.Ddd.EventSourcing.Deciding;

public class AggregateDeciderProvider : IAggregateDeciderProvider
{
    private static IDictionary<Type, List<(Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)>> _deciders = null!;

    public AggregateDeciderProvider(IOptions<AggregateExtractorConfiguration> options)
    {
        _deciders = options.Value.AggregateTypes
            .SelectMany(AggregateDeciderExtractor.ExtractDeciders)
            .GroupBy(
                decider => decider.CommandType,
                decider => (decider.AggregateType, decider.DeclaringType, decider.IdType, decider.Decide)
            )
            .ToDictionary(
                deciders => deciders.Key,
                deciders => deciders.ToList()
            );
    }

    public IDictionary<Type, List<(Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)>> GetAggregateDeciders() => _deciders;
}
