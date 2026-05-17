---
base_model:
- Snowflake/snowflake-arctic-embed-m-long
library_name: sentence-transformers
license: mit
---


# CodeRankEmbed

`CodeRankEmbed` is a 137M bi-encoder supporting 8192 context length for code retrieval. It significantly outperforms various open-source and proprietary code embedding models on various code retrieval tasks.  

Check out our [blog post](https://gangiswag.github.io/cornstack/) and [paper](https://arxiv.org/pdf/2412.01007) for more details!

Combine `CodeRankEmbed` with our re-ranker [`CodeRankLLM`](https://huggingface.co/cornstack/CodeRankLLM) for even higher quality code retrieval.

# Performance Benchmarks

| Name                             | Parameters | CSN (MRR)      | CoIR (NDCG@10)     |
| :-------------------------------:| :----- | :-------- | :------: | 
| **CodeRankEmbed**              | 137M   | **77.9** |**60.1** | 
| Arctic-Embed-M-Long       | 137M   | 53.4    | 43.0    | 
| CodeSage-Small       | 130M   | 64.9    | 54.4    | 
| CodeSage-Base       | 356M   | 68.7    | 57.5    | 
| CodeSage-Large       | 1.3B   | 71.2    | 59.4    | 
| Jina-Code-v2           | 161M   | 67.2     | 58.4  |
| CodeT5+          | 110M   | 74.2     | 45.9     | 
| OpenAI-Ada-002          | 110M   | 71.3     | 45.6     | 
| Voyage-Code-002        | Unknown   | 68.5     | 56.3     | 


We release the scripts to evaluate our model's performance [here](https://github.com/gangiswag/cornstack).

# Usage

**Important**: the query prompt *must* include the following *task instruction prefix*: "Represent this query for searching relevant code" 

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("nomic-ai/CodeRankEmbed", trust_remote_code=True)
queries = ['Represent this query for searching relevant code: Calculate the n-th factorial']
codes = ['def fact(n):\n if n < 0:\n  raise ValueError\n return 1 if n == 0 else n * fact(n - 1)']
query_embeddings = model.encode(queries)
print(query_embeddings)
code_embeddings = model.encode(codes)
print(code_embeddings)
```



## Training
We use a bi-encoder architecture for `CodeRankEmbed`, with weights shared between the text and code encoder. The retriever is contrastively fine-tuned with InfoNCE loss on a 21 million example high-quality dataset we curated called [CoRNStack](https://gangiswag.github.io/cornstack/). Our encoder is initialized with [Arctic-Embed-M-Long](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-long), a 137M parameter text encoder supporting an extended context length of 8,192 tokens.

# Citation

If you find the model, dataset, or training code useful, please cite our work:

```bibtex
@misc{suresh2025cornstackhighqualitycontrastivedata,
      title={CoRNStack: High-Quality Contrastive Data for Better Code Retrieval and Reranking}, 
      author={Tarun Suresh and Revanth Gangi Reddy and Yifei Xu and Zach Nussbaum and Andriy Mulyar and Brandon Duderstadt and Heng Ji},
      year={2025},
      eprint={2412.01007},
      archivePrefix={arXiv},
      primaryClass={cs.CL},
      url={https://arxiv.org/abs/2412.01007}, 
}
```