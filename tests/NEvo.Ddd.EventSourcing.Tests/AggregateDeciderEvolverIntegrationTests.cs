using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing.Tests;

public class AggregateDeciderEvolverIntegrationTests
{
    private readonly AggregateDecider _decider;
    private readonly AggregateEvolver _evolver;

    public AggregateDeciderEvolverIntegrationTests()
    {
        var configuration = new AggregateExtractorConfiguration()
        {
            AggregateTypes = { typeof(DocumentAggregateBase) }
        };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        _decider = new AggregateDecider(deciderProvider);
        _evolver = new AggregateEvolver([typeof(DocumentAggregateBase)]);
    }

    [Fact]
    public async Task CreateDocumentCommand_WhenProcessed_ReturnsEditableDocumentWithCorrectData()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var command = new CreateDocument(aggregate.Id, "Data");

        // act
        var result = await aggregate.ExecuteAsync(
            _decider,
            _evolver,
            command,
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeOfType<EditableDocument>().Which
            .Data.Should().Be("Data");
    }
}
