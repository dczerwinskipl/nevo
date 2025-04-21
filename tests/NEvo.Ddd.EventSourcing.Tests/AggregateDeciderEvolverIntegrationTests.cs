using LanguageExt;
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
            AggregateTypes = { typeof(Document) }
        };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        _decider = new AggregateDecider(deciderProvider);
        _evolver = new AggregateEvolver([typeof(Document)]);
    }

    [Fact]
    public async Task CreateDocumentCommand_WhenProcessed_ReturnsEditableDocumentWithCorrectData()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = Option<Document>.None;
        var command = new CreateDocument(id, "Data");

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
